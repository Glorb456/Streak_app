from fastapi import APIRouter, HTTPException

from .. import db
from ..schemas import Category, CategoryIn

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[Category])
async def list_categories():
    rows = await db.pool().fetch(db.sql("categories_list"))
    return [dict(r) for r in rows]


@router.post("/categories", response_model=Category)
async def create_category(body: CategoryIn):
    row = await db.pool().fetchrow(db.sql("categories_create"), body.name, body.color)
    return dict(row)


@router.put("/categories/{category_id}", response_model=Category)
async def update_category(category_id: int, body: CategoryIn):
    row = await db.pool().fetchrow(
        db.sql("categories_update"), category_id, body.name, body.color
    )
    if row is None:
        raise HTTPException(404, "category not found")
    return dict(row)


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int):
    await db.pool().execute(db.sql("categories_delete"), category_id)
    return {"ok": True}
