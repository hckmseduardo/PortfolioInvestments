from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List

from app.api.auth import get_current_user
from app.database.json_db import get_db
from app.models.schemas import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_LAYOUT = [
    "total_value",
    "book_value",
    "capital_gains",
    "dividends",
    "total_gains",
    "accounts_summary",
    "performance",
    "accounts_list"
]


class DashboardLayoutUpdate(BaseModel):
    layout: List[str]


def _sanitize_layout(layout: List[str]) -> List[str]:
    cleaned: List[str] = []
    for item in layout:
        if item in DEFAULT_LAYOUT and item not in cleaned:
            cleaned.append(item)
    if not cleaned:
        cleaned = DEFAULT_LAYOUT.copy()
    return cleaned


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
