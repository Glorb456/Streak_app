import datetime as dt

import asyncpg
from fastapi import APIRouter, HTTPException

from .. import db
from ..schemas import DailyCompletion, DailyTask, DailyTaskIn

router = APIRouter(tags=["daily"])


@router.get("/daily", response_model=list[DailyTask])
async def list_daily_tasks():
    rows = await db.pool().fetch(db.sql("daily_tasks_list"))
    return [dict(r) for r in rows]


# Declared before the /daily/{daily_id} routes so "completions" is not
# captured as a path parameter.
@router.get("/daily/completions", response_model=list[DailyCompletion])
async def list_completions(start: dt.date, end: dt.date):
    rows = await db.pool().fetch(db.sql("daily_completions_range"), start, end)
    return [dict(r) for r in rows]


@router.put("/daily/completions", response_model=DailyCompletion)
async def set_completion(body: DailyCompletion):
    try:
        row = await db.pool().fetchrow(
            db.sql("daily_completions_set"), body.daily_task_id, body.day, body.completed
        )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(404, "daily task not found")
    return dict(row)


def _required_on(day: dt.date, masks: list[int]) -> int:
    """How many active daily tasks are scheduled on the given day."""
    bit = 1 << day.weekday()  # weekday(): Monday == 0, matching days_mask
    return sum(1 for m in masks if m & bit)


# Current streak: consecutive days on which every daily task scheduled for that
# day was completed. Today only counts once it's fully done — an unfinished
# today doesn't break yesterday's streak. The client sends its local date so
# the server timezone is irrelevant.
@router.get("/daily/streak")
async def get_streak(today: dt.date):
    rows = await db.pool().fetch(db.sql("daily_tasks_list"))
    masks = [r["days_mask"] for r in rows]
    # No active tasks, or every one parked at mask 0: nothing is ever required,
    # so there is no streak. This is also what keeps the walk below finite —
    # with the vacuous rule in satisfied(), an all-zero mask set would make
    # every day satisfied and run the loop until date underflow.
    if not any(masks):
        return {"streak": 0}

    start = today - dt.timedelta(days=400)
    counts = await db.pool().fetch(db.sql("daily_streak_counts"), start, today)
    done = {r["day"]: r["done"] for r in counts}

    def satisfied(day: dt.date) -> bool:
        required = _required_on(day, masks)
        # A day with nothing scheduled carries the streak through rather than
        # breaking it. Return False here for the opposite rule.
        if not required:
            return True
        return done.get(day, 0) >= required

    day = today
    if not satisfied(day):
        day -= dt.timedelta(days=1)
    streak = 0
    while day >= start and satisfied(day):
        streak += 1
        day -= dt.timedelta(days=1)
    return {"streak": streak}


@router.post("/daily", response_model=DailyTask)
async def create_daily_task(body: DailyTaskIn):
    row = await db.pool().fetchrow(
        db.sql("daily_tasks_create"), body.name, body.color, body.days_mask
    )
    return dict(row)


@router.put("/daily/{daily_id}", response_model=DailyTask)
async def update_daily_task(daily_id: int, body: DailyTaskIn):
    row = await db.pool().fetchrow(
        db.sql("daily_tasks_update"),
        daily_id,
        body.name,
        body.color,
        body.active,
        body.days_mask,
    )
    if row is None:
        raise HTTPException(404, "daily task not found")
    return dict(row)


@router.delete("/daily/{daily_id}")
async def delete_daily_task(daily_id: int):
    await db.pool().execute(db.sql("daily_tasks_delete"), daily_id)
    return {"ok": True}
