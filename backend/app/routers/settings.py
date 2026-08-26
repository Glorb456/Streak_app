from fastapi import APIRouter

from .. import db
from ..schemas import SettingIn

router = APIRouter(tags=["settings"])

# Bookkeeping keys the UI never uses; kept out of the API surface.
INTERNAL_KEYS = {"seeded"}


@router.get("/settings")
async def get_settings():
    rows = await db.pool().fetch(db.sql("settings_get"))
    return {r["key"]: r["value"] for r in rows if r["key"] not in INTERNAL_KEYS}


@router.put("/settings")
async def set_setting(body: SettingIn):
    row = await db.pool().fetchrow(db.sql("settings_set"), body.key, body.value)
    return {row["key"]: row["value"]}
