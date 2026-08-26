import datetime as dt

import asyncpg
from fastapi import APIRouter, HTTPException

from .. import db
from ..schemas import Task, TaskCreate, TaskReorder, TaskUpdate

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=list[Task])
async def list_tasks(start: dt.date, end: dt.date):
    rows = await db.pool().fetch(db.sql("tasks_list_range"), start, end)
    return [dict(r) for r in rows]


@router.post("/tasks", response_model=Task)
async def create_task(body: TaskCreate):
    try:
        row = await db.pool().fetchrow(
            db.sql("tasks_create"),
            body.description,
            body.notes,
            body.category_id,
            body.due_date,
        )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(400, "category not found")
    return dict(row)


# Declared before /tasks/{task_id}: routes are matched in definition order and
# {task_id} is an int, so the other order would match "reorder" against it first
# and answer this endpoint with a 422 instead.
@router.put("/tasks/reorder", response_model=list[Task])
async def reorder_tasks(body: TaskReorder):
    """Rewrite one day's ordering, then hand back that day as it now stands.

    Ids for other days are ignored by the query rather than rejected, so this
    stays idempotent and a client whose list is one poll out of date cannot
    corrupt a day it wasn't looking at.
    """
    await db.pool().execute(db.sql("tasks_reorder"), body.due_date, body.ids)
    rows = await db.pool().fetch(
        db.sql("tasks_list_range"), body.due_date, body.due_date
    )
    return [dict(r) for r in rows]


@router.put("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: int, body: TaskUpdate):
    row = await db.pool().fetchrow(
        db.sql("tasks_update"),
        task_id,
        body.description,
        body.notes,
        body.category_id,
        body.due_date,
        body.done,
    )
    if row is None:
        raise HTTPException(404, "task not found")
    return dict(row)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int):
    await db.pool().execute(db.sql("tasks_delete"), task_id)
    return {"ok": True}
