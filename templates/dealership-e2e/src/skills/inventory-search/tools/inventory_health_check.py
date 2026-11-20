import json

from azure_functions_agents import tool
from tools._inventory_core import HEALTH_TOOL_DESCRIPTION, HEALTH_TOOL_NAME, evaluate_inventory_health


@tool(name=HEALTH_TOOL_NAME, description=HEALTH_TOOL_DESCRIPTION)
def inventory_health_check_agent_tool(threshold_override: int | None = None) -> str:
    """Check inventory levels and recommend replenishment for low-stock categories."""
    return json.dumps(evaluate_inventory_health(threshold_override=threshold_override))
