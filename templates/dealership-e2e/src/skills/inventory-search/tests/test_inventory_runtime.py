import json
import sys
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT))

from azure_functions_agents.discovery.tools import clear_tool_discovery_cache, discover_project_tools
from tools import _inventory_core as inventory_search


class InventoryRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        clear_tool_discovery_cache()
        self.addCleanup(inventory_search._RUNTIME_RESTOCKED_VEHICLES.clear)

    async def test_runtime_discovers_and_invokes_inventory_search(self):
        discovered = discover_project_tools(SKILL_ROOT)
        tools = {item.name: item for item in discovered.user_tools}

        self.assertIn("inventory-search", tools)
        response = await tools["inventory-search"].invoke(
            arguments={"max_price": 40000, "min_ev_range_miles": 250, "limit": 2},
            skip_parsing=True,
        )
        result = json.loads(response)
        self.assertGreater(result["match_count"], 0)
        self.assertLessEqual(result["match_count"], 2)
        self.assertTrue(all(car["price"] <= 40000 and car["ev_range_miles"] >= 250 for car in result["matches"]))

    async def test_runtime_discovers_and_invokes_inventory_health(self):
        discovered = discover_project_tools(SKILL_ROOT)
        tools = {item.name: item for item in discovered.user_tools}

        self.assertIn("inventory-health-check", tools)
        response = await tools["inventory-health-check"].invoke(
            arguments={"threshold_override": 50},
            skip_parsing=True,
        )
        result = json.loads(response)
        self.assertEqual(result["status"], "low_inventory")
        self.assertGreater(result["low_stock_count"], 0)
        self.assertTrue(result["recommended_replenishment"]["vehicles"])

    def test_restock_keeps_id_based_vehicles_and_ignores_duplicates(self):
        vehicle = {
            "id": "test-inventory-restock",
            "price": 35000,
            "ev_range_miles": 300,
            "powertrain": "EV",
            "features": [],
        }

        first = inventory_search.apply_inventory_restock([vehicle], approved_by="test")
        second = inventory_search.apply_inventory_restock([vehicle], approved_by="test")

        self.assertEqual(first["added_count"], 1)
        self.assertEqual(second["added_count"], 0)
        self.assertEqual(
            sum(car.get("id") == vehicle["id"] for car in inventory_search.load_inventory()),
            1,
        )

    async def test_restock_is_visible_to_the_discovered_search_tool(self):
        vehicle = {
            "id": "test-inventory-visible-to-search",
            "price": 12345,
            "ev_range_miles": 500,
            "powertrain": "EV",
            "features": [],
        }
        inventory_search.apply_inventory_restock([vehicle], approved_by="test")
        tools = {item.name: item for item in discover_project_tools(SKILL_ROOT).user_tools}

        response = await tools["inventory-search"].invoke(
            arguments={"max_price": 12345, "min_ev_range_miles": 500},
            skip_parsing=True,
        )
        result = json.loads(response)
        self.assertIn(vehicle["id"], [car.get("id") for car in result["matches"]])

    def test_health_counts_each_vehicle_category(self):
        inventory = [
            {"id": "ev", "powertrain": "EV", "price": 35000, "ev_range_miles": 300,
             "features": ["third-row seating"]},
            {"id": "hybrid", "powertrain": "Hybrid"},
            {"id": "plug-in", "powertrain": "Plug-in Hybrid"},
            {"id": "gas", "powertrain": "Gas"},
        ]

        result = inventory_search.evaluate_inventory_health(inventory, threshold_override=2)

        for category in ("EV_under_40k_250mi", "EV", "three_row_ev", "Hybrid", "Plug-in Hybrid", "Gas"):
            self.assertEqual(result["categories"][category]["available"], 1)
            self.assertEqual(result["categories"][category]["deficit"], 1)


if __name__ == "__main__":
    unittest.main()
