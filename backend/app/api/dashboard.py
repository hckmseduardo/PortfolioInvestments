from typing import Any, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.models.schemas import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_LAYOUT: List[dict[str, int]] = [
    {"id": "total_value", "x": 0, "y": 0, "w": 3, "h": 1},
    {"id": "book_value", "x": 3, "y": 0, "w": 3, "h": 1},
    {"id": "capital_gains", "x": 6, "y": 0, "w": 3, "h": 1},
    {"id": "dividends", "x": 9, "y": 0, "w": 3, "h": 1},
    {"id": "total_gains", "x": 0, "y": 1, "w": 3, "h": 1},
    {"id": "accounts_summary", "x": 3, "y": 1, "w": 3, "h": 1},
    {"id": "industry_breakdown", "x": 6, "y": 1, "w": 3, "h": 2},
    {"id": "performance", "x": 0, "y": 2, "w": 8, "h": 3},
    {"id": "accounts_list", "x": 8, "y": 2, "w": 4, "h": 3}
]

_ALLOWED_IDS = {item["id"] for item in DEFAULT_LAYOUT}
_DEFAULT_TILE_MAP = {item["id"]: item for item in DEFAULT_LAYOUT}


class DashboardLayoutUpdate(BaseModel):
    layout: List[Any]


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


def _coerce_tile(raw: Any) -> Optional[dict]:
    data = _to_dict(raw)
    if not data:
        return None

    tile_id = data.get("id")
    if tile_id not in _ALLOWED_IDS:
        return None

    base = _DEFAULT_TILE_MAP[tile_id].copy()
    for key in ("x", "y", "w", "h", "minW", "minH"):
        value = data.get(key)
        if value is not None:
            try:
                base[key] = int(value)
            except (TypeError, ValueError):
                continue
    return base


def _sanitize_layout(layout: List[Any]) -> List[dict]:
    sanitized: List[dict] = []
    seen: set[str] = set()

    for item in layout or []:
        tile = _coerce_tile(item)
        if not tile:
            continue
        tile_id = tile["id"]
        if tile_id in seen:
            continue
        sanitized.append(tile)
        seen.add(tile_id)

    for tile in DEFAULT_LAYOUT:
        if tile["id"] not in seen:
            sanitized.append(tile.copy())

    return sanitized


@router.get("/layout")
async def get_layout(current_user: User = Depends(get_current_user)):
    db = get_db()
    record = db.find_one("dashboard_layouts", {"user_id": current_user.id})
    if record and isinstance(record.get("layout"), list):
        layout = _sanitize_layout(record["layout"])
        return {"layout": layout, "source": "custom"}
    return {"layout": DEFAULT_LAYOUT, "source": "default"}


@router.put("/layout")
async def save_layout(
    payload: DashboardLayoutUpdate,
    current_user: User = Depends(get_current_user)
):
    layout = _sanitize_layout(payload.layout)
    db = get_db()
    existing = db.find_one("dashboard_layouts", {"user_id": current_user.id})
    if existing:
        db.update("dashboard_layouts", existing["id"], {"layout": layout})
    else:
        db.insert("dashboard_layouts", {"user_id": current_user.id, "layout": layout})
    return {"layout": layout}


@router.delete("/layout")
async def reset_layout(current_user: User = Depends(get_current_user)):
    db = get_db()
    db.delete("dashboard_layouts", {"user_id": current_user.id})
    return {"layout": DEFAULT_LAYOUT, "source": "default"}
