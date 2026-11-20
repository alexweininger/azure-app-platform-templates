import { expect, test } from "@playwright/test";

test("the development server is interactive on loopback and rejects other origins", async ({
  page,
  request
}) => {
  await page.goto("/");
  const copy = page.getByTestId("starter-prompt-copy");
  await copy.click();
  await expect(copy).toHaveText("Copied");

  const asset = await page.locator('script[src*="/_next/static/"]').first().getAttribute("src");
  if (!asset) throw new Error("The page did not render a client script.");
  const crossOrigin = await request.get(asset, {
    headers: { origin: "https://untrusted.example" }
  });
  expect(crossOrigin.status()).toBe(403);
});
