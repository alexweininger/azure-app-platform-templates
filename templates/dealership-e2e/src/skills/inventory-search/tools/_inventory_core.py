from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "inventory.json"
DEFAULT_LIMIT = 10
MAX_LIMIT = 50

TOOL_NAME = "inventory-search"
TOOL_DESCRIPTION = (
    "Filter synthetic inventory by budget, range/MPG, odometer miles, and required features."
)
HEALTH_TOOL_NAME = "inventory-health-check"
HEALTH_TOOL_DESCRIPTION = (
    "Check dealership vehicle inventory stock levels by category and return low-stock deficits plus a recommended replenishment order."
)

DEFAULT_CATEGORY_THRESHOLDS: dict[str, int] = {
    "EV_under_40k_250mi": 8,
    "EV": 12,
    "three_row_ev": 3,
    "Hybrid": 8,
    "Plug-in Hybrid": 4,
    "Gas": 6,
}

CATEGORY_LABELS = {
    "EV_under_40k_250mi": "EVs under $40,000 with at least 250 miles of range",
    "EV": "Electric vehicles",
    "three_row_ev": "Three-row family EVs",
    "Hybrid": "Hybrids",
    "Plug-in Hybrid": "Plug-in hybrids",
    "Gas": "Gas vehicles",
}

RECOMMENDED_RESTOCK_CATALOG: dict[str, list[dict[str, Any]]] = {
    "EV_under_40k_250mi": [
        {
            "id": "restock-ev-001",
            "make": "Hyundai",
            "model": "Ioniq 6 SE Long Range",
            "year": 2024,
            "price": 37200,
            "ev_range_miles": 361,
            "mpg": None,
            "odometer_miles": 4100,
            "features": ["car seat room", "fast charging", "adaptive cruise", "blind spot monitor"],
            "powertrain": "EV",
            "epa_source_id": "47910",
        },
        {
            "id": "restock-ev-002",
            "make": "Chevrolet",
            "model": "Equinox EV LT",
            "year": 2024,
            "price": 34995,
            "ev_range_miles": 319,
            "mpg": None,
            "odometer_miles": 2800,
            "features": ["car seat room", "heated seats", "360 camera", "lane keep assist"],
            "powertrain": "EV",
            "epa_source_id": "48201",
        },
    ],
    "three_row_ev": [
        {
            "vin": "5YJYGDEE4RF901101",
            "year": 2024,
            "make": "Tesla",
            "model": "Model Y",
            "trim": "Long Range AWD (7-Seat)",
            "price": 38900,
            "ev_range_miles": 310,
            "mpg": None,
            "odometer_miles": 9400,
            "powertrain": "EV",
            "features": ["third-row seating", "all-wheel drive", "heated seats", "fast charging", "Apple CarPlay"],
        },
        {
            "vin": "KM8KRDAF8RU901102",
            "year": 2024,
            "make": "Kia",
            "model": "EV9",
            "trim": "Light Long Range",
            "price": 39800,
            "ev_range_miles": 304,
            "mpg": None,
            "odometer_miles": 11200,
            "powertrain": "EV",
            "features": ["third-row seating", "Apple CarPlay", "blind spot monitoring", "fast charging", "lane keep assist"],
        },
    ],
    "Hybrid": [
        {
            "id": "restock-hyb-001",
            "make": "Toyota",
            "model": "Camry Hybrid SE",
            "year": 2024,
            "price": 30800,
            "ev_range_miles": None,
            "mpg": 51,
            "odometer_miles": 8900,
            "features": ["car seat room", "adaptive cruise", "wireless carplay"],
            "powertrain": "Hybrid",
            "epa_source_id": "47312",
        },
        {
            "id": "restock-hyb-002",
            "make": "Honda",
            "model": "Accord Hybrid EX-L",
            "year": 2023,
            "price": 32400,
            "ev_range_miles": None,
            "mpg": 48,
            "odometer_miles": 11500,
            "features": ["car seat room", "leather seats", "blind spot monitor"],
            "powertrain": "Hybrid",
            "epa_source_id": "46288",
        },
    ],
    "Plug-in Hybrid": [
        {
            "id": "restock-phev-001",
            "make": "Toyota",
            "model": "RAV4 Prime SE",
            "year": 2023,
            "price": 38900,
            "ev_range_miles": 42,
            "mpg": 38,
            "odometer_miles": 14300,
            "features": ["car seat room", "all wheel drive", "heated seats"],
            "powertrain": "Plug-in Hybrid",
            "epa_source_id": "46109",
        },
        {
            "id": "restock-phev-002",
            "make": "Kia",
            "model": "Sorento Plug-in Hybrid",
            "year": 2023,
            "price": 39500,
            "ev_range_miles": 32,
            "mpg": 34,
            "odometer_miles": 15800,
            "features": ["third-row seating", "car seat room", "blind spot monitor"],
            "powertrain": "Plug-in Hybrid",
            "epa_source_id": "46155",
        },
    ],
    "Gas": [
        {
            "id": "restock-gas-001",
            "make": "Honda",
            "model": "Pilot EX-L",
            "year": 2022,
            "price": 32900,
            "ev_range_miles": None,
            "mpg": 23,
            "odometer_miles": 27400,
            "features": ["third-row seating", "car seat room", "apple carplay"],
            "powertrain": "Gas",
            "epa_source_id": "44812",
        },
    ],
}
RECOMMENDED_RESTOCK_CATALOG["EV"] = RECOMMENDED_RESTOCK_CATALOG["EV_under_40k_250mi"]

_RUNTIME_RESTOCKED_VEHICLES: list[dict[str, Any]] = []
TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "min_price": {"type": "number"},
        "max_price": {"type": "number"},
        "min_ev_range_miles": {"type": "number"},
        "min_mpg": {"type": "number"},
        "max_odometer_miles": {"type": "number"},
        "year_min": {"type": "integer"},
        "year_max": {"type": "integer"},
        "required_features": {
            "type": "array",
            "items": {"type": "string"}
        },
        "sort_by": {
            "type": "string",
            "enum": ["price", "year", "ev_range_miles", "mpg", "odometer_miles"],
        },
        "sort_direction": {"type": "string", "enum": ["asc", "desc"]},
        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT},
    },
}


def load_inventory(path: Path = DATA_PATH) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        base = json.load(f)
    if path == DATA_PATH and _RUNTIME_RESTOCKED_VEHICLES:
        existing_ids = {_vehicle_id(car) for car in base}
        extra = [car for car in _RUNTIME_RESTOCKED_VEHICLES if _vehicle_id(car) not in existing_ids]
        return [*base, *extra]
    return base


def _vehicle_id(car: dict[str, Any]) -> str | None:
    return car.get("vin") or car.get("id")


def evaluate_inventory_health(
    inventory: list[dict[str, Any]] | None = None,
    *,
    threshold_override: int | None = None,
) -> dict[str, Any]:
    """Evaluate dealership stock levels across vehicle segments and build a restock recommendation."""
    cars = inventory if inventory is not None else load_inventory()
    ev_cars = [c for c in cars if str(c.get("powertrain", "")).upper() == "EV"]
    affordable_long_range_evs = [
        c
        for c in ev_cars
        if (_coerce_number(c.get("price")) or 999999) <= 40000
        and (_coerce_number(c.get("ev_range_miles")) or 0) >= 250
    ]
    three_row_evs = [
        c
        for c in ev_cars
        if _matches_required_features(c, ["third-row seating"])
    ]
    hybrid_cars = [c for c in cars if str(c.get("powertrain", "")).upper() == "HYBRID"]
    plug_in_hybrid_cars = [c for c in cars if str(c.get("powertrain", "")).upper() == "PLUG-IN HYBRID"]
    gas_cars = [c for c in cars if str(c.get("powertrain", "")).upper() == "GAS"]

    counts = {
        "EV_under_40k_250mi": len(affordable_long_range_evs),
        "EV": len(ev_cars),
        "three_row_ev": len(three_row_evs),
        "Hybrid": len(hybrid_cars),
        "Plug-in Hybrid": len(plug_in_hybrid_cars),
        "Gas": len(gas_cars),
    }

    categories: dict[str, dict[str, Any]] = {}
    low_stock_categories: list[dict[str, Any]] = []
    recommended_vehicles: list[dict[str, Any]] = []
    existing_ids = {_vehicle_id(c) for c in cars}

    for key, default_threshold in DEFAULT_CATEGORY_THRESHOLDS.items():
        min_stock = threshold_override if threshold_override is not None else default_threshold
        available = counts.get(key, 0)
        deficit = max(0, min_stock - available)
        status = "low" if deficit > 0 else "healthy"
        entry = {
            "category": key,
            "label": CATEGORY_LABELS[key],
            "available": available,
            "threshold": min_stock,
            "deficit": deficit,
            "status": status,
        }
        categories[key] = entry
        if deficit > 0:
            low_stock_categories.append(entry)
            for candidate in RECOMMENDED_RESTOCK_CATALOG.get(key, []):
                candidate_id = _vehicle_id(candidate)
                if candidate_id and candidate_id not in existing_ids:
                    recommended_vehicles.append({**candidate, "category": key})
                    existing_ids.add(candidate_id)

    overall_status = "low_inventory" if low_stock_categories else "healthy"
    return {
        "status": overall_status,
        "total_vehicles": len(cars),
        "low_stock_count": len(low_stock_categories),
        "categories": categories,
        "low_stock_categories": low_stock_categories,
        "recommended_replenishment": {
            "requires_human_approval": bool(low_stock_categories),
            "vehicle_count": len(recommended_vehicles),
            "estimated_total_usd": sum(int(v.get("price", 0)) for v in recommended_vehicles),
            "vehicles": recommended_vehicles,
        },
    }


def apply_inventory_restock(
    vehicles: list[dict[str, Any]] | None = None,
    *,
    order_id: str | None = None,
    approved_by: str | None = None,
) -> dict[str, Any]:
    """Append approved replenishment vehicles to the runtime inventory store."""
    if vehicles is None:
        health = evaluate_inventory_health()
        vehicles = health["recommended_replenishment"]["vehicles"]

    existing_ids = {_vehicle_id(car) for car in load_inventory()}
    added: list[dict[str, Any]] = []
    for vehicle in vehicles:
        if not isinstance(vehicle, dict):
            continue
        vehicle_id = _vehicle_id(vehicle)
        if not vehicle_id or vehicle_id in existing_ids:
            continue
        clean_vehicle = {k: v for k, v in vehicle.items() if k != "category"}
        _RUNTIME_RESTOCKED_VEHICLES.append(clean_vehicle)
        existing_ids.add(vehicle_id)
        added.append(clean_vehicle)

    updated_health = evaluate_inventory_health()
    return {
        "status": "restocked",
        "order_id": order_id or "restock-order-default",
        "approved_by": approved_by or "dealership-manager",
        "added_count": len(added),
        "added_vins": [v["vin"] for v in added if v.get("vin")],
        "added_ids": [_vehicle_id(v) for v in added],
        "total_vehicles": updated_health["total_vehicles"],
        "inventory_status": updated_health["status"],
    }



def normalize_feature(feature: str) -> str:
    return " ".join(feature.casefold().strip().split())


def _coerce_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _matches_required_features(car: dict[str, Any], required_features: list[str]) -> bool:
    if not required_features:
        return True

    car_features = [normalize_feature(f) for f in car.get("features", [])]
    return all(any(req in available for available in car_features) for req in required_features)


def search_inventory(
    inventory: list[dict[str, Any]],
    *,
    min_price: float | None = None,
    max_price: float | None = None,
    min_ev_range_miles: float | None = None,
    min_mpg: float | None = None,
    max_odometer_miles: float | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
    required_features: list[str] | None = None,
    sort_by: str = "price",
    sort_direction: str = "asc",
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    required_features = [normalize_feature(f) for f in (required_features or [])]
    filtered: list[dict[str, Any]] = []

    for car in inventory:
        price = _coerce_number(car.get("price"))
        ev_range = _coerce_number(car.get("ev_range_miles"))
        mpg = _coerce_number(car.get("mpg"))
        odometer = _coerce_number(car.get("odometer_miles"))
        year = _coerce_int(car.get("year"))

        if min_price is not None and (price is None or price < min_price):
            continue
        if max_price is not None and (price is None or price > max_price):
            continue
        if min_ev_range_miles is not None and (ev_range is None or ev_range < min_ev_range_miles):
            continue
        if min_mpg is not None and (mpg is None or mpg < min_mpg):
            continue
        if max_odometer_miles is not None and (odometer is None or odometer > max_odometer_miles):
            continue
        if year_min is not None and (year is None or year < year_min):
            continue
        if year_max is not None and (year is None or year > year_max):
            continue
        if not _matches_required_features(car, required_features):
            continue

        filtered.append(car)

    reverse = sort_direction.casefold() == "desc"

    def _sort_key(car: dict[str, Any]) -> tuple[int, float]:
        value = _coerce_number(car.get(sort_by))
        if value is None:
            return (1, 0.0)
        return (0, value)

    filtered.sort(key=_sort_key, reverse=reverse)
    return filtered[: max(1, min(limit, MAX_LIMIT))]


def run_inventory_search(payload: dict[str, Any], inventory: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    inventory_data = inventory if inventory is not None else load_inventory()

    min_price = _coerce_number(payload.get("min_price"))
    max_price = _coerce_number(payload.get("max_price"))
    min_ev_range_miles = _coerce_number(payload.get("min_ev_range_miles"))
    min_mpg = _coerce_number(payload.get("min_mpg"))
    max_odometer_miles = _coerce_number(payload.get("max_odometer_miles"))
    year_min = _coerce_int(payload.get("year_min"))
    year_max = _coerce_int(payload.get("year_max"))
    sort_by = str(payload.get("sort_by") or "price")
    sort_direction = str(payload.get("sort_direction") or "asc")
    limit = _coerce_int(payload.get("limit")) or DEFAULT_LIMIT

    required_features = payload.get("required_features") or payload.get("features") or []
    if isinstance(required_features, str):
        required_features = [required_features]

    matches = search_inventory(
        inventory_data,
        min_price=min_price,
        max_price=max_price,
        min_ev_range_miles=min_ev_range_miles,
        min_mpg=min_mpg,
        max_odometer_miles=max_odometer_miles,
        year_min=year_min,
        year_max=year_max,
        required_features=list(required_features),
        sort_by=sort_by,
        sort_direction=sort_direction,
        limit=limit,
    )

    return {
        "tool": TOOL_NAME,
        "query": {
            "min_price": min_price,
            "max_price": max_price,
            "min_ev_range_miles": min_ev_range_miles,
            "min_mpg": min_mpg,
            "max_odometer_miles": max_odometer_miles,
            "year_min": year_min,
            "year_max": year_max,
            "required_features": required_features,
            "sort_by": sort_by,
            "sort_direction": sort_direction,
            "limit": limit,
        },
        "total_inventory": len(inventory_data),
        "match_count": len(matches),
        "matches": matches,
    }
