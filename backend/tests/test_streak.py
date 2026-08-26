import datetime as dt

TODAY = dt.date(2026, 7, 15)


def _day(offset):
    return (TODAY + dt.timedelta(days=offset)).isoformat()


def _complete_all(client, offset):
    for d in client.get("/api/daily").json():
        client.put(
            "/api/daily/completions",
            json={"daily_task_id": d["id"], "day": _day(offset), "completed": True},
        )


def _streak(client):
    return client.get(f"/api/daily/streak?today={TODAY.isoformat()}").json()["streak"]


def test_no_completions_means_zero(client):
    assert _streak(client) == 0


def test_counts_consecutive_fully_done_days(client):
    _complete_all(client, -2)
    _complete_all(client, -1)
    _complete_all(client, 0)
    assert _streak(client) == 3


def test_unfinished_today_does_not_break_streak(client):
    _complete_all(client, -2)
    _complete_all(client, -1)
    assert _streak(client) == 2


def test_gap_breaks_streak(client):
    _complete_all(client, -3)
    _complete_all(client, -1)  # -2 missed
    _complete_all(client, 0)
    assert _streak(client) == 2


def test_partially_done_day_does_not_count(client):
    first = client.get("/api/daily").json()[0]["id"]  # seed has 2 daily tasks
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": first, "day": _day(-1), "completed": True},
    )
    _complete_all(client, 0)
    assert _streak(client) == 1


def test_no_active_daily_tasks_means_zero(client):
    _complete_all(client, 0)
    for d in client.get("/api/daily").json():
        client.delete(f"/api/daily/{d['id']}")
    assert _streak(client) == 0


# ---------- weekday schedules ----------
# TODAY (2026-07-15) is a Wednesday, so offset -1 is Tuesday and -2 is Monday.
MON = 1 << 0
EVERY_DAY_BUT_TUE = 127 & ~(1 << 1)


def _set_mask(client, task, mask):
    client.put(
        f"/api/daily/{task['id']}",
        json={"name": task["name"], "color": task["color"], "days_mask": mask},
    )


def _set_all_masks(client, mask):
    for d in client.get("/api/daily").json():
        _set_mask(client, d, mask)


def _complete(client, task_id, offset):
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": task_id, "day": _day(offset), "completed": True},
    )


def test_only_scheduled_tasks_are_required(client):
    tasks = client.get("/api/daily").json()  # seed has 2
    _set_mask(client, tasks[1], MON)  # second task is Mondays only
    _complete(client, tasks[0]["id"], -1)  # Tue
    _complete(client, tasks[0]["id"], 0)  # Wed
    # Tue and Wed need only the every-day task; Monday needs both and has
    # neither, so that is where the run ends.
    assert _streak(client) == 2


def test_day_with_nothing_scheduled_does_not_break_streak(client):
    # Flip this expectation if an unscheduled day should end a streak instead
    # (see the `if not required` branch in routers/daily.py::get_streak).
    _set_all_masks(client, EVERY_DAY_BUT_TUE)
    _complete_all(client, -2)  # Mon
    _complete_all(client, 0)  # Wed
    # Tuesday has nothing due, so it carries the run instead of ending it.
    assert _streak(client) == 3


def test_completion_on_an_unscheduled_day_does_not_count(client):
    tasks = client.get("/api/daily").json()
    _set_mask(client, tasks[0], MON)  # Mondays only
    # The second task keeps the every-day default, so Wednesday still needs it.
    # Completing the Monday-only task on a Wednesday must not stand in for it.
    _complete(client, tasks[0]["id"], 0)
    assert _streak(client) == 0


def test_all_tasks_parked_means_zero(client):
    # Nothing is ever required, which without the early return in get_streak
    # would walk backwards until the date underflows rather than answering.
    _set_all_masks(client, 0)
    _complete_all(client, 0)
    assert _streak(client) == 0
