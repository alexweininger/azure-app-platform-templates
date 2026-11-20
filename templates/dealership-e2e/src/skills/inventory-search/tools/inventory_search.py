import json
from typing import Any

from azure_functions_agents import tool
from tools._inventory_core import DEFAULT_LIMIT, TOOL_DESCRIPTION, TOOL_NAME, run_inventory_search


def inventory_search_tool(arguments: dict[str, Any]) -> dict[str, Any]:
    """MCP tool entrypoint when this Function App is hosted as a toolserver."""
    return run_inventory_search(arguments)


@tool(name=TOOL_NAME, description=TOOL_DESCRIPTION)
def inventory_search_agent_tool(
    min_price: float | None = None,
    max_price: float | None = None,
    min_ev_range_miles: float | None = None,
    min_mpg: float | None = None,
    max_odometer_miles: float | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
    required_features: list[str] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
    limit: int | None = None,
) -> str:
    """Filter synthetic inventory by budget, range/MPG, odometer miles, and required features."""
    return json.dumps(
        run_inventory_search(
            {
                "min_price": min_price,
                "max_price": max_price,
                "min_ev_range_miles": min_ev_range_miles,
                "min_mpg": min_mpg,
                "max_odometer_miles": max_odometer_miles,
                "year_min": year_min,
                "year_max": year_max,
                "required_features": required_features or [],
                "sort_by": sort_by or "price",
                "sort_direction": sort_direction or "asc",
                "limit": limit or DEFAULT_LIMIT,
            }
        )
    )
