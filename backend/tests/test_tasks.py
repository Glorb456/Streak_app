import asyncio

import asyncpg

from app.db import DATABASE_URL

D = "2026-07-15"


def _new(client, **over):
    body = {"description": "task", "notes": "", "due_date": D}
    body.update(over)
    return client.post("/api/tasks", json=body).json()


def test_create_defaults(client):
    t = _new(client, description="Read email")
    assert t["description"] == "Read email"
    assert t["done"] is False
    assert t["category_id"] is None
    assert t["project_id"] is None
    assert t["due_date"] == D


def test_created_task_appears_in_range(client):
    t = _new(client)
    lst = client.get(f"/api/tasks?start={D}&end={D}").json()
    assert any(x["id"] == t["id"] for x in lst)


def test_range_is_inclusive_at_boundaries(client):
    _new(client, description="start", due_date="2026-07-01")
    _new(client, description="end", due_date="2026-07-31")
    descs = [
        x["description"]
        for x in client.get("/api/tasks?start=2026-07-01&end=2026-07-31").json()
    ]
    assert "start" in descs and "end" in descs


def test_range_excludes_outside(client):
    _new(client, description="inside", due_date="2026-07-10")
    _new(client, description="before", due_date="2026-06-30")
    _new(client, description="after", due_date="2026-08-01")
    descs = [
        x["description"]
        for x in client.get("/api/tasks?start=2026-07-01&end=2026-07-31").json()
    ]
    assert "inside" in descs
    assert "before" not in descs
    assert "after" not in descs


def test_list_ordered_by_due_date(client):
    _new(client, description="later", due_date="2026-07-20")
    _new(client, description="earlier", due_date="2026-07-05")
    dates = [
        x["due_date"]
        for x in client.get("/api/tasks?start=2026-07-01&end=2026-07-31").json()
    ]
    assert dates == sorted(dates)


def test_update_toggles_done_and_edits_fields(client):
    t = _new(client)
    body = {
        "description": "renamed",
        "notes": "n2",
        "category_id": None,
        "due_date": D,
        "done": True,
    }
    r = client.put(f"/api/tasks/{t['id']}", json=body)
    assert r.status_code == 200
    out = r.json()
    assert out["done"] is True
    assert out["description"] == "renamed"
    assert out["notes"] == "n2"


def test_update_can_move_due_date(client):
    t = _new(client)
    body = {
        "description": t["description"],
        "notes": "",
        "category_id": None,
        "due_date": "2026-07-20",
        "done": False,
    }
    client.put(f"/api/tasks/{t['id']}", json=body)
    assert client.get(f"/api/tasks?start={D}&end={D}").json() == []
    moved = client.get("/api/tasks?start=2026-07-20&end=2026-07-20").json()
    assert moved and moved[0]["id"] == t["id"]


def test_update_missing_returns_404(client):
    body = {
        "description": "x",
        "notes": "",
        "category_id": None,
        "due_date": D,
        "done": False,
    }
    assert client.put("/api/tasks/999999", json=body).status_code == 404


def test_delete_removes_task(client):
    t = _new(client)
    client.delete(f"/api/tasks/{t['id']}")
    lst = client.get(f"/api/tasks?start={D}&end={D}").json()
    assert all(x["id"] != t["id"] for x in lst)


def test_create_with_bad_category_is_4xx(client):
    r = client.post(
        "/api/tasks",
        json={"description": "t", "due_date": D, "category_id": 999999},
    )
    assert 400 <= r.status_code < 500


# --------------------------------------------------------------------------
# Ordering within a day
# --------------------------------------------------------------------------
def _ids(client, day=D):
    return [t["id"] for t in client.get(f"/api/tasks?start={day}&end={day}").json()]


def test_new_task_goes_to_the_top_of_its_day(client):
    first = _new(client, description="oldest")
    second = _new(client, description="middle")
    third = _new(client, description="newest")
    assert _ids(client) == [third["id"], second["id"], first["id"]]


def test_new_task_tops_its_own_day_only(client):
    other = _new(client, description="other day", due_date="2026-07-20")
    a = _new(client)
    b = _new(client)
    assert _ids(client) == [b["id"], a["id"]]
    assert _ids(client, "2026-07-20") == [other["id"]]


def test_rows_without_a_position_keep_id_order(client):
    """A database that predates the column has every row at the 0 default.

    Reaches past the API on purpose: this is the one claim the migration makes
    that no endpoint can put the data into, since tasks_create has never
    written a 0.
    """
    a = _new(client)
    b = _new(client)
    c = _new(client)

    async def _flatten():
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            await conn.execute("UPDATE tasks SET position = 0")
        finally:
            await conn.close()

    asyncio.run(_flatten())
    assert _ids(client) == [a["id"], b["id"], c["id"]]


def test_reorder_rewrites_the_day(client):
    a = _new(client, description="a")
    b = _new(client, description="b")
    c = _new(client, description="c")
    want = [a["id"], c["id"], b["id"]]
    r = client.put("/api/tasks/reorder", json={"due_date": D, "ids": want})
    assert r.status_code == 200
    assert [t["id"] for t in r.json()] == want   # response reflects the new order
    assert _ids(client) == want                  # and so does a fresh read


def test_reorder_normalises_positions_to_zero_upwards(client):
    a = _new(client)
    b = _new(client)
    out = client.put(
        "/api/tasks/reorder", json={"due_date": D, "ids": [a["id"], b["id"]]}
    ).json()
    assert [t["position"] for t in out] == [0, 1]


def test_reorder_is_idempotent(client):
    a = _new(client)
    b = _new(client)
    want = [b["id"], a["id"]]
    client.put("/api/tasks/reorder", json={"due_date": D, "ids": want})
    client.put("/api/tasks/reorder", json={"due_date": D, "ids": want})
    assert _ids(client) == want


def test_reorder_ignores_ids_from_another_day(client):
    a = _new(client)
    b = _new(client)
    other = _new(client, due_date="2026-07-20")
    # A stale client sends a list contaminated with another day's task.
    client.put(
        "/api/tasks/reorder",
        json={"due_date": D, "ids": [other["id"], b["id"], a["id"]]},
    )
    assert _ids(client) == [b["id"], a["id"]]
    assert _ids(client, "2026-07-20") == [other["id"]]


def test_reorder_ignores_unknown_ids(client):
    a = _new(client)
    b = _new(client)
    r = client.put(
        "/api/tasks/reorder", json={"due_date": D, "ids": [999999, b["id"], a["id"]]}
    )
    assert r.status_code == 200
    assert _ids(client) == [b["id"], a["id"]]


def test_reorder_of_an_empty_day_is_a_noop(client):
    r = client.put("/api/tasks/reorder", json={"due_date": "2026-07-09", "ids": []})
    assert r.status_code == 200
    assert r.json() == []


def test_ordinary_update_preserves_position(client):
    a = _new(client, description="a")
    b = _new(client, description="b")
    client.put("/api/tasks/reorder", json={"due_date": D, "ids": [a["id"], b["id"]]})
    client.put(
        f"/api/tasks/{a['id']}",
        json={
            "description": "renamed",
            "notes": "n",
            "category_id": None,
            "due_date": D,
            "done": True,
        },
    )
    assert _ids(client) == [a["id"], b["id"]]


def test_moving_a_task_to_another_day_puts_it_on_top(client):
    keep = _new(client, description="stays", due_date="2026-07-20")
    mover = _new(client, description="moves")
    client.put(
        f"/api/tasks/{mover['id']}",
        json={
            "description": "moves",
            "notes": "",
            "category_id": None,
            "due_date": "2026-07-20",
            "done": False,
        },
    )
    assert _ids(client, "2026-07-20") == [mover["id"], keep["id"]]


def test_deleting_the_top_task_promotes_the_next_one(client):
    bottom = _new(client)
    top = _new(client)
    assert _ids(client) == [top["id"], bottom["id"]]
    client.delete(f"/api/tasks/{top['id']}")
    assert _ids(client) == [bottom["id"]]
