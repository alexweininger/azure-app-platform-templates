"""Hosted Skill entry point for `inventory-search`, on the real
`azurefunctions-agents-runtime` (serverless agents runtime) package.

The runtime discovers `skills/inventory-search.agent.md` (front matter +
instructions), auto-discovers the `@tool`-decorated function in
`tools/inventory_search.py`, and registers the resulting agent's HTTP trigger
plus its `builtin_endpoints.mcp: true` MCP tool endpoint
(`/runtime/webhooks/mcp`) - the same Streamable HTTP transport a real Foundry
Toolbox uses, just pointed at localhost during local dev.
"""

from azure_functions_agents import create_function_app
from openai._client import AsyncOpenAI, WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER

_orig_prepare_request = AsyncOpenAI._prepare_request


async def _strip_placeholder_bearer_auth(self, request):
    await _orig_prepare_request(self, request)
    if request.headers.get("authorization") == f"Bearer {WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}":
        del request.headers["authorization"]


AsyncOpenAI._prepare_request = _strip_placeholder_bearer_auth

import azure.functions as func
from azurefunctions.extensions.http.fastapi import JSONResponse, Request
from tools._inventory_core import apply_inventory_restock, evaluate_inventory_health

app = create_function_app()


@app.route(route="inventory/health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
async def get_inventory_health(req: Request) -> JSONResponse:
    raw_threshold = req.query_params.get("threshold")
    if raw_threshold is not None and not raw_threshold.isdigit():
        return JSONResponse({"error": "threshold must be a non-negative integer"}, status_code=400)
    threshold_override = int(raw_threshold) if raw_threshold is not None else None
    report = evaluate_inventory_health(threshold_override=threshold_override)
    return JSONResponse(report)


@app.route(route="inventory/restock", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
async def post_inventory_restock(req: Request) -> JSONResponse:
    try:
        payload = await req.json()
    except (ValueError, UnicodeDecodeError):
        return JSONResponse({"error": "Request body must be valid JSON"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "Request body must be an object"}, status_code=400)
    approved_by = payload.get("approvedBy")
    if not isinstance(approved_by, str) or not approved_by.strip():
        return JSONResponse({"error": "approvedBy is required"}, status_code=400)
    vehicles = payload.get("vehicles")
    if vehicles is not None and not isinstance(vehicles, list):
        return JSONResponse({"error": "vehicles must be an array"}, status_code=400)
    result = apply_inventory_restock(
        vehicles,
        order_id=payload.get("orderId"),
        approved_by=approved_by.strip(),
    )
    return JSONResponse(result)

