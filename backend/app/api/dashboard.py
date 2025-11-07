import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.models.schemas import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

LAYOUT_PROFILES = [
    "desktop",
    "tablet_landscape",
    "tablet_portrait",
    "mobile_landscape",
    "mobile_portrait",
]

PROFILE_DEFAULT_LAYOUTS: Dict[str, List[dict[str, int]]] = {
    "desktop": [
        {"id": "book_value", "x": 0, "y": 0, "w": 3, "h": 1},
        {"id": "capital_gains", "x": 3, "y": 0, "w": 3, "h": 1},
        {"id": "dividends", "x": 6, "y": 0, "w": 3, "h": 1},
        {"id": "total_gains", "x": 9, "y": 0, "w": 3, "h": 1},
        {"id": "accounts_summary", "x": 0, "y": 1, "w": 4, "h": 1},
        {"id": "total_value", "x": 4, "y": 1, "w": 4, "h": 1},
        {"id": "accounts_list", "x": 0, "y": 2, "w": 12, "h": 2},
        {"id": "performance", "x": 0, "y": 4, "w": 12, "h": 3},
        {"id": "type_breakdown", "x": 0, "y": 7, "w": 6, "h": 6, "minH": 6},
        {"id": "industry_breakdown", "x": 6, "y": 7, "w": 6, "h": 6, "minH": 6},
    ],
    "tablet_landscape": [
        {"id": "book_value", "x": 0, "y": 0, "w": 3, "h": 1},
        {"id": "capital_gains", "x": 3, "y": 0, "w": 3, "h": 1},
        {"id": "dividends", "x": 6, "y": 0, "w": 3, "h": 1},
        {"id": "total_gains", "x": 9, "y": 0, "w": 3, "h": 1},
        {"id": "accounts_summary", "x": 0, "y": 1, "w": 4, "h": 1},
        {"id": "total_value", "x": 4, "y": 1, "w": 4, "h": 1},
        {"id": "accounts_list", "x": 0, "y": 2, "w": 12, "h": 2},
        {"id": "performance", "x": 0, "y": 4, "w": 12, "h": 3},
        {"id": "type_breakdown", "x": 0, "y": 7, "w": 6, "h": 6, "minH": 6},
        {"id": "industry_breakdown", "x": 6, "y": 7, "w": 6, "h": 6, "minH": 6},
    ],
    "tablet_portrait": [
        {"id": "book_value", "x": 0, "y": 0, "w": 4, "h": 1},
        {"id": "capital_gains", "x": 4, "y": 0, "w": 4, "h": 1},
        {"id": "dividends", "x": 0, "y": 1, "w": 4, "h": 1},
        {"id": "total_gains", "x": 4, "y": 1, "w": 4, "h": 1},
        {"id": "accounts_summary", "x": 0, "y": 2, "w": 4, "h": 1},
        {"id": "total_value", "x": 4, "y": 2, "w": 4, "h": 1},
        {"id": "accounts_list", "x": 0, "y": 3, "w": 8, "h": 2},
        {"id": "performance", "x": 0, "y": 5, "w": 8, "h": 3},
        {"id": "type_breakdown", "x": 0, "y": 8, "w": 4, "h": 6, "minH": 6},
        {"id": "industry_breakdown", "x": 4, "y": 8, "w": 4, "h": 6, "minH": 6},
    ],
    "mobile_landscape": [
        {"id": "book_value", "x": 0, "y": 0, "w": 3, "h": 1},
        {"id": "capital_gains", "x": 3, "y": 0, "w": 3, "h": 1},
        {"id": "dividends", "x": 0, "y": 1, "w": 3, "h": 1},
        {"id": "total_gains", "x": 3, "y": 1, "w": 3, "h": 1},
        {"id": "accounts_summary", "x": 0, "y": 2, "w": 3, "h": 1},
        {"id": "total_value", "x": 3, "y": 2, "w": 3, "h": 1},
        {"id": "accounts_list", "x": 0, "y": 3, "w": 6, "h": 2},
        {"id": "performance", "x": 0, "y": 5, "w": 6, "h": 3},
        {"id": "type_breakdown", "x": 0, "y": 8, "w": 6, "h": 6, "minH": 6},
        {"id": "industry_breakdown", "x": 0, "y": 14, "w": 6, "h": 6, "minH": 6},
    ],
    "mobile_portrait": [
        {"id": "book_value", "x": 0, "y": 0, "w": 4, "h": 1},
        {"id": "capital_gains", "x": 0, "y": 1, "w": 4, "h": 1},
        {"id": "dividends", "x": 0, "y": 2, "w": 4, "h": 1},
        {"id": "total_gains", "x": 0, "y": 3, "w": 4, "h": 1},
        {"id": "accounts_summary", "x": 0, "y": 4, "w": 4, "h": 1},
        {"id": "total_value", "x": 0, "y": 5, "w": 4, "h": 1},
        {"id": "accounts_list", "x": 0, "y": 6, "w": 4, "h": 2},
        {"id": "performance", "x": 0, "y": 8, "w": 4, "h": 3},
        {"id": "type_breakdown", "x": 0, "y": 11, "w": 4, "h": 8, "minH": 8},
        {"id": "industry_breakdown", "x": 0, "y": 19, "w": 4, "h": 8, "minH": 8},
    ],
}

_EXTRA_TILES = {
    "total_value": {"id": "total_value", "x": 0, "y": 0, "w": 3, "h": 1},
}

_ALLOWED_IDS = set(_EXTRA_TILES.keys())
for layout in PROFILE_DEFAULT_LAYOUTS.values():
    for tile in layout:
        _ALLOWED_IDS.add(tile["id"])

_PROFILE_TILE_MAP: Dict[str, Dict[str, dict[str, int]]] = {
    profile: {tile["id"]: tile for tile in layout}
    for profile, layout in PROFILE_DEFAULT_LAYOUTS.items()
}


class DashboardLayoutUpdate(BaseModel):
    profile: str = "desktop"
    layout: List[Any]


def _normalize_profile(profile: Optional[str]) -> str:
    if profile in LAYOUT_PROFILES:
        return profile
    return "desktop"


def _to_dict(item: Any) -> Optional[dict]:
    if item is None:
        return None
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        return {"id": item}
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return None


def _get_profile_defaults(profile: str) -> List[dict]:
    return [tile.copy() for tile in PROFILE_DEFAULT_LAYOUTS.get(profile, PROFILE_DEFAULT_LAYOUTS["desktop"])]


def _coerce_tile(raw: Any, profile: str) -> Optional[dict]:
    data = _to_dict(raw)
    if not data:
        return None

    tile_id = data.get("id")
    if tile_id not in _ALLOWED_IDS:
        return None

    profile_map = _PROFILE_TILE_MAP.get(profile)
    base = None
    if profile_map:
        base = profile_map.get(tile_id)
    if not base:
        base = _EXTRA_TILES.get(tile_id)
    if not base:
        return None

    result = base.copy()
    for key in ("x", "y", "w", "h", "minW", "minH"):
        value = data.get(key)
        if value is not None:
            try:
                result[key] = int(value)
            except (TypeError, ValueError):
                continue
    result["minW"] = int(result.get("minW") or base.get("minW") or 1)
    result["minH"] = int(result.get("minH") or base.get("minH") or 1)
    result["w"] = max(int(result.get("w", base.get("w", result["minW"]))), result["minW"])
    result["h"] = max(int(result.get("h", base.get("h", result["minH"]))), result["minH"])
    return result


def _sanitize_layout(layout: Optional[List[Any]], profile: str) -> List[dict]:
    if not layout:
        return _get_profile_defaults(profile)

    sanitized: List[dict] = []
    seen: set[str] = set()

    for item in layout or []:
        tile = _coerce_tile(item, profile)
        if not tile:
            continue
        tile_id = tile["id"]
        if tile_id in seen:
            continue
        sanitized.append(tile)
        seen.add(tile_id)

    for tile in PROFILE_DEFAULT_LAYOUTS.get(profile, PROFILE_DEFAULT_LAYOUTS["desktop"]):
        if tile["id"] not in seen:
            sanitized.append(tile.copy())

    return sanitized


def _coerce_layout_container(value: Any) -> Dict[str, List[dict]]:
    raw = value
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        raw = parsed

    if isinstance(raw, dict):
        container: Dict[str, List[dict]] = {}
        for key, items in raw.items():
            if isinstance(items, list):
                container[key] = list(items)
        return container
    if isinstance(raw, list):
        return {"desktop": raw}
    return {}


@router.get("/layout")
async def get_layout(
    profile: str = "desktop",
    current_user: User = Depends(get_current_user)
):
    profile = _normalize_profile(profile)
    db = get_db()
    record = db.find_one("dashboard_layouts", {"user_id": current_user.id})
    if record:
        container = _coerce_layout_container(record.get("layout") or record.get("layout_data"))
        profile_layout = container.get(profile)
        layout = _sanitize_layout(profile_layout, profile)
        return {"layout": layout, "profile": profile, "source": "custom"}
    return {"layout": _get_profile_defaults(profile), "profile": profile, "source": "default"}


@router.put("/layout")
async def save_layout(
    payload: DashboardLayoutUpdate,
    current_user: User = Depends(get_current_user)
):
    profile = _normalize_profile(payload.profile)
    layout = _sanitize_layout(payload.layout, profile)
    db = get_db()
    existing = db.find_one("dashboard_layouts", {"user_id": current_user.id})
    if existing:
        container = _coerce_layout_container(existing.get("layout") or existing.get("layout_data"))
        container[profile] = layout
        db.update("dashboard_layouts", existing["id"], {"layout_data": container})
    else:
        db.insert("dashboard_layouts", {"user_id": current_user.id, "layout_data": {profile: layout}})
    return {"layout": layout, "profile": profile}


@router.delete("/layout")
async def reset_layout(
    profile: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    db = get_db()
    profile = _normalize_profile(profile) if profile else None
    record = db.find_one("dashboard_layouts", {"user_id": current_user.id})
    if not record:
        if profile:
            return {"layout": _get_profile_defaults(profile), "profile": profile, "source": "default"}
        return {"layout": _get_profile_defaults("desktop"), "profile": "desktop", "source": "default"}

    if not profile:
        db.delete("dashboard_layouts", {"user_id": current_user.id})
        return {"layout": _get_profile_defaults("desktop"), "profile": "desktop", "source": "default"}

    container = _coerce_layout_container(record.get("layout") or record.get("layout_data"))
    if profile in container:
        del container[profile]
        if container:
            db.update("dashboard_layouts", record["id"], {"layout_data": container})
        else:
            db.delete("dashboard_layouts", {"user_id": current_user.id})
    return {"layout": _get_profile_defaults(profile), "profile": profile, "source": "default"}
