import datetime as dt

from pydantic import BaseModel, Field


class Category(BaseModel):
    id: int
    name: str
    color: str
    position: int


class CategoryIn(BaseModel):
    name: str
    color: str = "#7a7a7a"


class Task(BaseModel):
    id: int
    description: str
    notes: str
    category_id: int | None
    project_id: int | None
    due_date: dt.date
    done: bool
    # Ascending within a day; may be negative, since new tasks are inserted
    # above the current minimum rather than renumbering the day.
    position: int


class TaskCreate(BaseModel):
    description: str = ""
    notes: str = ""
    category_id: int | None = None
    due_date: dt.date


class TaskUpdate(BaseModel):
    description: str
    notes: str
    category_id: int | None = None
    due_date: dt.date
    done: bool


class TaskReorder(BaseModel):
    """One day's ids in the order they should appear.

    Whole-day rather than per-task so a reorder cannot half-apply: the server
    rewrites that day's positions from this array in one statement.
    """

    due_date: dt.date
    ids: list[int]


class DailyTask(BaseModel):
    id: int
    name: str
    color: str
    position: int
    active: bool
    days_mask: int


class DailyTaskIn(BaseModel):
    name: str
    color: str = "#f9e2ce"
    # Lets a soft-deleted daily task be reactivated; harmless on create.
    active: bool = True
    # Weekday schedule; bit 0 = Monday ... bit 6 = Sunday. 127 = every day.
    # 0 is allowed and parks the task: due on no day, required by no streak.
    days_mask: int = Field(127, ge=0, le=127)


class DailyCompletion(BaseModel):
    daily_task_id: int
    day: dt.date
    completed: bool


class SettingIn(BaseModel):
    key: str
    value: str
