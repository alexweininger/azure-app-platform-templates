import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const templates = fileURLToPath(new URL("../templates", import.meta.url));

for (const name of [
  "empty-starter-app", "app-service-builder-vite", "app-service-builder-ai-gateway",
  "sandboxes-minimal", "sandbox-gateway-minimal", "dealership-e2e", "shared/dealer",
]) {
  test(`${name} stops only a process with a matching creation time`, {
    skip: process.platform !== "win32" && "Windows process identity test",
    timeout: 30_000,
  }, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "template-process-safety-"));
    const scripts = path.join(root, "scripts");
    const run = path.join(root, ".dev-run");
    await mkdir(scripts);
    await mkdir(run);
    const sourceFile = name === "dealership-e2e" || name === "shared/dealer"
      ? "dev-stop.ps1" : "dev-stop.ps1.template";
    await cp(path.join(templates, name, "scripts", sourceFile), path.join(scripts, "dev-stop.ps1"));
    const state = path.join(run, "processes.json");
    const child = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      await rm(root, { recursive: true, force: true });
    });
    await once(child.stdout, "data");
    const identity = spawnSync("pwsh", [
      "-NoProfile", "-Command", `(Get-Process -Id ${child.pid}).StartTime.ToUniversalTime().ToString('O')`,
    ], { encoding: "utf8" });
    assert.equal(identity.status, 0, identity.stderr);
    const startedAt = identity.stdout.trim();
    const env = { ...process.env };
    delete env.DEALER_REPO_ROOT;
    const stop = () => spawnSync("pwsh", ["-NoProfile", "-File", path.join(scripts, "dev-stop.ps1")], {
      encoding: "utf8", env,
    });
    const record = value => JSON.stringify([{ name: "fixture", port: 4321, pid: child.pid, ...value }]);

    await writeFile(state, record({}));
    const missingIdentity = stop();
    assert.notEqual(missingIdentity.status, 0);
    assert.match(missingIdentity.stderr, /no recorded start identity/i);
    const retained = JSON.parse(await readFile(state, "utf8"));
    assert.equal((Array.isArray(retained) ? retained[0] : retained).pid, child.pid);
    assert.doesNotThrow(() => process.kill(child.pid, 0));

    await writeFile(state, record({ startedAt: "2000-01-01T00:00:00.0000000Z" }));
    const staleIdentity = stop();
    assert.equal(staleIdentity.status, 0, staleIdentity.stderr);
    assert.match(staleIdentity.stdout, /PID was reused/i);
    assert.doesNotThrow(() => process.kill(child.pid, 0));

    await mkdir(run, { recursive: true });
    await writeFile(state, record({ startedAt }));
    const owned = stop();
    assert.equal(owned.status, 0, owned.stderr);
    await exited;
    await assert.rejects(readFile(state), { code: "ENOENT" });
  });
}

test("the Vite starter records and stops its own process while preserving package policy", {
  skip: process.platform !== "win32" && "Windows process lifecycle test",
  timeout: 60_000,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "vite-lifecycle-"));
  const scripts = path.join(root, "scripts");
  const bin = path.join(root, "bin");
  const state = path.join(root, ".dev-run", "processes.json");
  for (const dir of [scripts, bin, path.join(root, "node_modules", "vite"), path.join(root, "dist")]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path.join(root, "dist", "index.html"), "fixture");
  await writeFile(path.join(scripts, "load-ports.ps1"), "function Import-AppPorts($Root) {}\n");
  for (const script of ["dev-start", "dev-stop"]) {
    await cp(path.join(templates, "app-service-builder-vite", "scripts", `${script}.ps1.template`),
      path.join(scripts, `${script}.ps1`));
  }
  await writeFile(path.join(bin, "web.cjs"), [
    "require('node:http').createServer((_req,res) => {",
    "res.end(JSON.stringify({ index: process.env.UV_INDEX_URL, offline: process.env.UV_OFFLINE }));",
    "}).listen(Number(process.env.WEB_PORT), '127.0.0.1');",
  ].join("\n"));
  await writeFile(path.join(bin, "npx.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0web.cjs"\r\n`);
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WEB_PORT: String(port),
    PIP_INDEX_URL: "https://packages.example.test/simple", UV_INDEX_URL: "https://other.example.test/simple",
    UV_DEFAULT_INDEX: "", UV_OFFLINE: "1",
  };
  delete env.DEALER_REPO_ROOT;
  const invoke = async script => {
    const runner = spawn("pwsh", ["-NoProfile", "-File", path.join(scripts, `${script}.ps1`)], {
      env, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    runner.stdout.on("data", data => { output += data; });
    runner.stderr.on("data", data => { output += data; });
    const [code] = await once(runner, "exit");
    runner.stdout.destroy();
    runner.stderr.destroy();
    return { code, output };
  };
  t.after(async () => {
    try { await readFile(state); }
    catch (error) { if (error.code === "ENOENT") return rm(root, { recursive: true, force: true }); throw error; }
    const stopped = await invoke("dev-stop");
    assert.equal(stopped.code, 0, stopped.output);
    await rm(root, { recursive: true, force: true });
  });

  const started = await invoke("dev-start");
  assert.equal(started.code, 0, started.output);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.deepEqual(await response.json(), { index: "https://packages.example.test/simple", offline: "1" });
  const records = JSON.parse(await readFile(state, "utf8"));
  const record = Array.isArray(records) ? records[0] : records;
  assert.ok(record.pid > 0 && record.startedAt);
  const stopped = await invoke("dev-stop");
  assert.equal(stopped.code, 0, stopped.output);
  await assert.rejects(readFile(state), { code: "ENOENT" });
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

test("the Vite starter stops when dependency installation fails", {
  skip: process.platform !== "win32" && "Windows startup test",
  timeout: 30_000,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "vite-install-failure-"));
  const scripts = path.join(root, "scripts");
  const bin = path.join(root, "bin");
  await mkdir(scripts);
  await mkdir(bin);
  await writeFile(path.join(scripts, "load-ports.ps1"), "function Import-AppPorts($Root) {}\n");
  for (const script of ["dev-start", "dev-stop"]) {
    await cp(path.join(templates, "app-service-builder-vite", "scripts", `${script}.ps1.template`),
      path.join(scripts, `${script}.ps1`));
  }
  await writeFile(path.join(bin, "npm.cmd"), "@echo off\r\nexit /b 21\r\n");
  await writeFile(path.join(bin, "npx.cmd"), `@echo off\r\necho started>"${path.join(root, "web-started")}"\r\nexit /b 1\r\n`);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync("pwsh", ["-NoProfile", "-File", path.join(scripts, "dev-start.ps1")], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependency installation failed \(exit 21\)/i);
  await assert.rejects(readFile(path.join(root, "web-started")), { code: "ENOENT" });
});

test("the Builder gateway starter does not launch web when its agent stays unhealthy", {
  skip: process.platform !== "win32" && "Windows startup test",
  timeout: 70_000,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "builder-agent-unhealthy-"));
  const scripts = path.join(root, "scripts");
  const agent = path.join(root, "src", "agent");
  const bin = path.join(root, "bin");
  for (const dir of [scripts, agent, bin]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(scripts, "load-ports.ps1"), "function Import-AppPorts($Root) {}\n");
  for (const script of ["dev-start", "dev-stop"]) {
    await cp(path.join(templates, "app-service-builder-ai-gateway", "scripts", `${script}.ps1.template`),
      path.join(scripts, `${script}.ps1`));
  }
  await link(process.execPath, path.join(bin, "uv.exe"));
  await writeFile(path.join(agent, "main.py"), "# fixture\n");
  await writeFile(path.join(agent, "run"), [
    "require('node:http').createServer((_req,res) => { res.statusCode=503; res.end('not ready'); })",
    ".listen(Number(process.env.AGENT_PORT), '127.0.0.1');",
  ].join("\n"));
  await writeFile(path.join(root, "run"), [
    `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "web-started"))}, 'started');`,
    "require('node:http').createServer((_req,res) => res.end('ok'))",
    ".listen(Number(process.env.WEB_PORT), '127.0.0.1');",
  ].join("\n"));
  const ports = [];
  for (let i = 0; i < 2; i++) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
    ports.push(probe.address().port);
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    AGENT_PORT: String(ports[0]), WEB_PORT: String(ports[1]),
  };
  const invoke = async script => {
    const runner = spawn("pwsh", ["-NoProfile", "-File", path.join(scripts, `${script}.ps1`)], {
      env, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    runner.stdout.on("data", data => { output += data; });
    runner.stderr.on("data", data => { output += data; });
    const [code] = await once(runner, "exit");
    runner.stdout.destroy();
    runner.stderr.destroy();
    return { code, output };
  };
  const state = path.join(root, ".dev-run", "processes.json");
  t.after(async () => {
    try { await readFile(state); }
    catch (error) { if (error.code === "ENOENT") return rm(root, { recursive: true, force: true }); throw error; }
    const stopped = await invoke("dev-stop");
    assert.equal(stopped.code, 0, stopped.output);
    await rm(root, { recursive: true, force: true });
  });
  const result = await invoke("dev-start");
  assert.notEqual(result.code, 0);
  assert.match(result.output, /agent did not become ready.*HTTP 503/i);
  await assert.rejects(readFile(path.join(root, "web-started")), { code: "ENOENT" });
  await assert.rejects(readFile(state), { code: "ENOENT" });
  await assert.rejects(fetch(`http://127.0.0.1:${ports[0]}/healthz`));
});

for (const name of ["dealership-e2e", "shared/dealer"]) {
  test(`${name} stops before launching later skills when the first skill fails`, {
    skip: process.platform !== "win32" && "Windows skill startup test",
    timeout: 60_000,
  }, async t => {
    const root = await mkdtemp(path.join(tmpdir(), "dealer-skill-order-"));
    const scripts = path.join(root, "scripts");
    const bin = path.join(root, "bin");
    const azurite = path.join(bin, "node_modules", "azurite", "dist", "src");
    const state = path.join(root, ".dev-run", "processes.json");
    await mkdir(scripts, { recursive: true });
    await mkdir(azurite, { recursive: true });
    await writeFile(path.join(scripts, "load-ports.ps1"), "function Import-AppPorts($Root) {}\n");
    for (const script of ["dev-start", "dev-stop"]) {
      await cp(path.join(templates, name, "scripts", `${script}.ps1`), path.join(scripts, `${script}.ps1`));
    }
    await link(process.execPath, path.join(bin, "uv.exe"));
    await writeFile(path.join(bin, "azurite.cmd"), "@echo off\r\nexit /b 0\r\n");
    await writeFile(path.join(azurite, "azurite.js"), [
      "const net = require('node:net');",
      "for (const flag of ['--blobPort', '--queuePort', '--tablePort']) {",
      "  const port = Number(process.argv[process.argv.indexOf(flag) + 1]);",
      "  net.createServer().listen(port, '127.0.0.1');",
      "}",
    ].join("\n"));
    for (const skill of ["inventory-search", "trade-in-value", "rate-sheet", "deal-doc"]) {
      const directory = path.join(root, "src", "skills", skill);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "local.settings.json"),
        JSON.stringify({ Values: { AZURE_FUNCTIONS_AGENTS_PROVIDER: "foundry" } }));
      await writeFile(path.join(directory, "run"), "console.error('fixture skill failed'); process.exit(17);\n");
    }
    const names = [
      "WEB_PORT", "AGENT_PORT", "INVENTORY_SEARCH_PORT", "TRADE_IN_VALUE_PORT", "RATE_SHEET_PORT",
      "DEAL_DOC_PORT", "AZURITE_BLOB_PORT", "AZURITE_QUEUE_PORT", "AZURITE_TABLE_PORT",
    ];
    const probes = [];
    for (let index = 0; index < names.length; index++) {
      const probe = net.createServer();
      await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
      probes.push(probe);
    }
    const ports = probes.map(probe => probe.address().port);
    await Promise.all(probes.map(probe => new Promise((resolve, reject) =>
      probe.close(error => error ? reject(error) : resolve()))));
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PIP_INDEX_URL: "https://packages.example.test/simple",
      ...Object.fromEntries(names.map((key, index) => [key, String(ports[index])])),
    };
    for (const key of Object.keys(env)) {
      if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|(?:API|ACCESS|PRIVATE)_KEY/i.test(key)) delete env[key];
    }
    delete env.DEALER_REPO_ROOT;
    delete env.DEALER_SCRIPT_DIR;
    delete env.FORCE_CLEAN;
    t.after(async () => {
      try {
        await readFile(state);
        const stopped = spawnSync("pwsh", ["-NoProfile", "-File", path.join(scripts, "dev-stop.ps1")], {
          encoding: "utf8", env, timeout: 15_000,
        });
        assert.equal(stopped.status, 0, stopped.stderr);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rm(root, { recursive: true, force: true });
    });

    const started = spawnSync("pwsh", [
      "-NoProfile", "-File", path.join(scripts, "dev-start.ps1"), "-SkipAgent", "-SkipWeb",
    ], { encoding: "utf8", env, timeout: 45_000 });
    assert.notEqual(started.status, 0);
    assert.match(`${started.stdout}\n${started.stderr}`, /failed to start/i);
    assert.match(await readFile(path.join(root, ".dev-run", "logs", "inventory-search.err.log"), "utf8"),
      /fixture skill failed/);
    await assert.rejects(readFile(path.join(root, ".dev-run", "logs", "trade-in-value.out.log")), { code: "ENOENT" });
    await assert.rejects(readFile(state), { code: "ENOENT" });
    for (const port of ports.slice(-3)) {
      const listening = await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.setTimeout(2_000);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", error => error.code === "ECONNREFUSED" ? resolve(false) : reject(error));
        socket.once("timeout", () => { socket.destroy(); reject(new Error("Port check timed out")); });
      });
      assert.equal(listening, false);
    }
  });
}

test("dealership retries a transient Functions provider failure once", {
  skip: process.platform !== "win32" && "Windows skill startup test",
  timeout: 240_000,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "dealer-provider-retry-"));
  const scripts = path.join(root, "scripts");
  const bin = path.join(root, "bin");
  const azurite = path.join(bin, "node_modules", "azurite", "dist", "src");
  const state = path.join(root, ".dev-run", "processes.json");
  await mkdir(scripts, { recursive: true });
  await mkdir(azurite, { recursive: true });
  await writeFile(path.join(scripts, "load-ports.ps1"), "function Import-AppPorts($Root) {}\n");
  for (const script of ["dev-start", "dev-stop"]) {
    await cp(path.join(templates, "dealership-e2e", "scripts", `${script}.ps1`),
      path.join(scripts, `${script}.ps1`));
  }
  await link(process.execPath, path.join(bin, "uv.exe"));
  await writeFile(path.join(bin, "azurite.cmd"), "@echo off\r\nexit /b 0\r\n");
  await writeFile(path.join(azurite, "azurite.js"), [
    "const net = require('node:net');",
    "for (const flag of ['--blobPort', '--queuePort', '--tablePort']) {",
    "  const port = Number(process.argv[process.argv.indexOf(flag) + 1]);",
    "  net.createServer().listen(port, '127.0.0.1');",
    "}",
  ].join("\n"));
  for (const skill of ["inventory-search", "trade-in-value", "rate-sheet", "deal-doc"]) {
    const directory = path.join(root, "src", "skills", skill);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "local.settings.json"),
      JSON.stringify({ Values: { AZURE_FUNCTIONS_AGENTS_PROVIDER: "foundry" } }));
    await writeFile(path.join(directory, "run"), [
      "const fs = require('node:fs'), path = require('node:path'), net = require('node:net');",
      "const name = path.basename(process.cwd()), marker = path.join(process.env.FIXTURE_ROOT, name + '.attempts');",
      "const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) + 1 : 1;",
      "fs.writeFileSync(marker, String(count));",
      "if (name === 'inventory-search' && (count === 1 || process.env.ALWAYS_FAIL === '1')) {",
      "  console.error(\"Value cannot be null. (Parameter 'provider')\"); process.exit(17);",
      "}",
      "net.createServer().listen(Number(process.argv.at(-1)), '127.0.0.1');",
    ].join("\n"));
  }
  const names = [
    "WEB_PORT", "AGENT_PORT", "INVENTORY_SEARCH_PORT", "TRADE_IN_VALUE_PORT", "RATE_SHEET_PORT",
    "DEAL_DOC_PORT", "AZURITE_BLOB_PORT", "AZURITE_QUEUE_PORT", "AZURITE_TABLE_PORT",
  ];
  const probes = [];
  for (let index = 0; index < names.length; index++) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
    probes.push(probe);
  }
  const ports = probes.map(probe => probe.address().port);
  await Promise.all(probes.map(probe => new Promise((resolve, reject) =>
    probe.close(error => error ? reject(error) : resolve()))));
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FIXTURE_ROOT: root,
    PIP_INDEX_URL: "https://packages.example.test/simple",
    ...Object.fromEntries(names.map((key, index) => [key, String(ports[index])])),
  };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|(?:API|ACCESS|PRIVATE)_KEY/i.test(key)) delete env[key];
  }
  delete env.DEALER_REPO_ROOT;
  delete env.DEALER_SCRIPT_DIR;
  delete env.FORCE_CLEAN;
  const invoke = (script, extraEnv = {}) => spawnSync("pwsh", [
    "-NoProfile", "-File", path.join(scripts, `${script}.ps1`),
    ...(script === "dev-start" ? ["-SkipAgent", "-SkipWeb"] : []),
  ], { encoding: "utf8", env: { ...env, ...extraEnv }, timeout: 90_000 });
  t.after(async () => {
    try {
      await readFile(state);
      const stopped = invoke("dev-stop");
      assert.equal(stopped.status, 0, stopped.stderr);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rm(root, { recursive: true, force: true });
  });

  const started = invoke("dev-start");
  assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
  assert.match(started.stdout, /provider error.*Retrying once/i);
  assert.equal(await readFile(path.join(root, "inventory-search.attempts"), "utf8"), "2");
  assert.equal(await readFile(path.join(root, "deal-doc.attempts"), "utf8"), "1");
  const tracked = JSON.parse(await readFile(state, "utf8"));
  assert.equal(tracked.filter(entry => entry.name === "inventory-search").length, 1);
  const stopped = invoke("dev-stop");
  assert.equal(stopped.status, 0, stopped.stderr);
  await rm(path.join(root, "inventory-search.attempts"));

  const failed = invoke("dev-start", { ALWAYS_FAIL: "1" });
  assert.notEqual(failed.status, 0);
  assert.equal(await readFile(path.join(root, "inventory-search.attempts"), "utf8"), "2");
  assert.equal(await readFile(path.join(root, "deal-doc.attempts"), "utf8"), "1");
  await assert.rejects(readFile(state), { code: "ENOENT" });
});

test("a Windows Git archive produces runnable Unix startup scripts", {
  timeout: 30_000,
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "template-unix-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.dirname(templates);
  const archive = path.join(root, "templates.tar");
  const paths = [
    "templates/dealership-e2e/scripts/dev-start.sh",
    "templates/app-service-builder-vite/scripts/dev-start.sh.template",
    "templates/shared/load-ports.sh",
  ];
  const archived = spawnSync("git", [
    "-C", repository, "-c", "core.autocrlf=true", "archive", "--worktree-attributes",
    "--format=tar", `--output=${archive}`, "HEAD", ...paths,
  ], { encoding: "utf8" });
  assert.equal(archived.status, 0, archived.stderr);
  const unpacked = spawnSync("tar", ["-xf", archive, "-C", root], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  await cp(path.join(root, "templates", "shared", "load-ports.sh"),
    path.join(root, "templates", "app-service-builder-vite", "scripts", "load-ports.sh"));
  for (const relative of paths.slice(0, 2)) {
    const result = spawnSync("bash", [path.join(root, ...relative.split("/")), "--help"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
});
