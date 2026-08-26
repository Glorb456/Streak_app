"""Multi-node sync: export/import merging, tombstones, conflicts, token auth.

These tests drive one real database through the same /api/sync/peer endpoints
two nodes would use on each other, hand-crafting the "remote" payloads. That
exercises every merge rule (insert, LWW update, skip, tombstone, conflict)
without needing a second postgres in the loop.
"""
import datetime as dt
import uuid

import pytest

from app import sync as sync_module

TOKEN = "test-sync-token"


@pytest.fixture(autouse=True)
def sync_token(monkeypatch):
    monkeypatch.setattr(sync_module, "SYNC_TOKEN", TOKEN)


def hdr():
    return {"X-Sync-Token": TOKEN}


def export(client, since=""):
    r = client.get("/api/sync/peer/export", params={"since": since}, headers=hdr())
    assert r.status_code == 200
    return r.json()


def do_import(client, payload):
    r = client.post("/api/sync/peer/import", json=payload, headers=hdr())
    assert r.status_code == 200
    return r.json()


def make_task(client, description="write tests", due="2026-08-26"):
    r = client.post("/api/tasks", json={"description": description, "due_date": due})
    assert r.status_code == 200
    return r.json()


def now_iso(offset_seconds=0):
    return (
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=offset_seconds)
    ).isoformat()


# ------------------------------------------------------------------- auth

def test_peer_endpoints_refuse_a_missing_or_wrong_token(client):
    assert client.get("/api/sync/peer/export").status_code == 401
    assert (
        client.get("/api/sync/peer/export", headers={"X-Sync-Token": "nope"}).status_code
        == 401
    )


def test_peer_endpoints_are_disabled_entirely_without_a_configured_token(
    client, monkeypatch
):
    monkeypatch.setattr(sync_module, "SYNC_TOKEN", "")
    assert client.get("/api/sync/peer/export", headers=hdr()).status_code == 403


# ----------------------------------------------------------------- export

def test_export_carries_uids_and_timestamps(client):
    make_task(client)
    data = export(client)
    tasks = data["tables"]["tasks"]
    assert len(tasks) == 1
    assert uuid.UUID(tasks[0]["uid"])
    assert tasks[0]["updated_at"]
    assert tasks[0]["description"] == "write tests"
    # Seeded categories ride along with uids too.
    assert all(uuid.UUID(c["uid"]) for c in data["tables"]["categories"])


def test_export_since_filters_to_changes_after_the_watermark(client):
    make_task(client, "old")
    watermark = now_iso(60)  # everything so far is older than this
    assert export(client, since=watermark)["tables"]["tasks"] == []


def test_a_tasks_category_travels_by_uid_not_id(client):
    cats = client.get("/api/categories").json()
    r = client.post(
        "/api/tasks",
        json={"description": "x", "due_date": "2026-08-26", "category_id": cats[0]["id"]},
    )
    assert r.status_code == 200
    row = export(client)["tables"]["tasks"][0]
    assert "category_id" not in row
    assert row["category_uid"] in {c["uid"] for c in export(client)["tables"]["categories"]}


# ----------------------------------------------------------------- import

def test_an_unknown_uid_is_inserted(client):
    payload = {
        "since": None,
        "tables": {
            "tasks": [{
                "uid": str(uuid.uuid4()),
                "updated_at": now_iso(),
                "description": "from the backup",
                "notes": "",
                "due_date": "2026-08-27",
                "done": False,
                "created_at": now_iso(),
                "position": 0,
                "category_uid": None,
                "project_uid": None,
            }]
        },
    }
    res = do_import(client, payload)
    assert res["applied"] == 1 and res["conflicts"] == 0
    descs = [t["description"] for t in
             client.get("/api/tasks?start=2026-08-27&end=2026-08-27").json()]
    assert descs == ["from the backup"]


def _as_remote(task_row, **changes):
    row = dict(task_row)
    row.update(changes)
    return row


def test_a_newer_remote_version_wins_and_an_older_one_is_skipped(client):
    make_task(client, "local")
    row = export(client)["tables"]["tasks"][0]

    newer = _as_remote(row, description="newer remote", updated_at=now_iso(60))
    do_import(client, {"since": None, "tables": {"tasks": [newer]}})
    assert [t["description"] for t in
            client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()] \
        == ["newer remote"]

    older = _as_remote(row, description="stale remote", updated_at=now_iso(-3600))
    do_import(client, {"since": None, "tables": {"tasks": [older]}})
    assert [t["description"] for t in
            client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()] \
        == ["newer remote"]


def test_reimporting_the_same_row_is_a_no_op(client):
    make_task(client)
    data = export(client)
    res = do_import(client, {"since": None, "tables": data["tables"],
                             "completions": data["completions"],
                             "settings": data["settings"],
                             "deletions": data["deletions"]})
    assert res["conflicts"] == 0
    assert len(client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()) == 1


# ------------------------------------------------------------ deletions

def test_a_local_delete_is_exported_as_a_tombstone(client):
    t = make_task(client)
    client.delete(f"/api/tasks/{t['id']}")
    dels = export(client)["deletions"]
    assert any(d["tbl"] == "tasks" for d in dels)


def test_an_imported_deletion_removes_the_row(client):
    make_task(client)
    row = export(client)["tables"]["tasks"][0]
    do_import(client, {"since": None, "deletions": [
        {"tbl": "tasks", "uid": row["uid"], "deleted_at": now_iso(60)},
    ]})
    assert client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json() == []


def test_a_deleted_row_does_not_resurrect_from_an_older_edit(client):
    t = make_task(client)
    row = export(client)["tables"]["tasks"][0]
    client.delete(f"/api/tasks/{t['id']}")
    # The remote copy predates the delete: it must stay dead.
    do_import(client, {"since": None, "tables": {"tasks": [
        _as_remote(row, updated_at=now_iso(-3600)),
    ]}})
    assert client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json() == []


def test_an_edit_newer_than_the_delete_resurrects_and_flags_a_conflict(client):
    t = make_task(client)
    row = export(client)["tables"]["tasks"][0]
    client.delete(f"/api/tasks/{t['id']}")
    res = do_import(client, {"since": None, "tables": {"tasks": [
        _as_remote(row, description="edited elsewhere", updated_at=now_iso(3600)),
    ]}})
    assert res["conflicts"] == 1
    assert [x["description"] for x in
            client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()] \
        == ["edited elsewhere"]


# ------------------------------------------------------------ conflicts

def test_both_sides_changed_logs_a_conflict_and_the_newer_wins(client):
    make_task(client, "original")
    row = export(client)["tables"]["tasks"][0]
    since = now_iso()  # last agreement: now — both edits below come after it

    t = client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()[0]
    client.put(f"/api/tasks/{t['id']}", json={
        "description": "local edit", "notes": "", "category_id": None,
        "due_date": "2026-08-26", "done": False,
    })
    res = do_import(client, {"since": since, "tables": {"tasks": [
        _as_remote(row, description="remote edit", updated_at=now_iso(3600)),
    ]}})
    assert res["conflicts"] == 1

    conflicts = client.get("/api/sync/conflicts").json()
    assert len(conflicts) == 1
    assert conflicts[0]["kept"]["description"] == "remote edit"
    assert conflicts[0]["lost"]["description"] == "local edit"


def test_restoring_a_conflicts_losing_version_puts_it_back(client):
    test_both_sides_changed_logs_a_conflict_and_the_newer_wins(client)
    c = client.get("/api/sync/conflicts").json()[0]
    r = client.post(f"/api/sync/conflicts/{c['id']}/resolve", json={"restore": True})
    assert r.status_code == 200
    assert [t["description"] for t in
            client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()] \
        == ["local edit"]
    assert client.get("/api/sync/conflicts").json() == []


def test_keeping_the_winner_just_clears_the_conflict(client):
    test_both_sides_changed_logs_a_conflict_and_the_newer_wins(client)
    c = client.get("/api/sync/conflicts").json()[0]
    client.post(f"/api/sync/conflicts/{c['id']}/resolve", json={"restore": False})
    assert [t["description"] for t in
            client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()] \
        == ["remote edit"]
    assert client.get("/api/sync/conflicts").json() == []


# ----------------------------------------------------- settings + completions

def test_settings_merge_last_writer_wins(client):
    client.put("/api/settings", json={"key": "background_color", "value": "#111111"})
    do_import(client, {"since": None, "settings": [
        {"key": "background_color", "value": "#222222", "updated_at": now_iso(3600)},
    ]})
    assert client.get("/api/settings").json()["background_color"] == "#222222"
    do_import(client, {"since": None, "settings": [
        {"key": "background_color", "value": "#333333", "updated_at": now_iso(-3600)},
    ]})
    assert client.get("/api/settings").json()["background_color"] == "#222222"


def test_completions_travel_by_daily_task_uid(client):
    daily = client.get("/api/daily").json()
    client.put("/api/daily/completions", json={
        "daily_task_id": daily[0]["id"], "day": "2026-08-26", "completed": True,
    })
    exp = export(client)
    assert exp["completions"][0]["daily_task_uid"]

    # Flip it "remotely" with a newer timestamp: the merge applies it.
    comp = dict(exp["completions"][0])
    comp.update(completed=False, updated_at=now_iso(3600))
    do_import(client, {"since": None, "completions": [comp]})
    got = client.get("/api/daily/completions?start=2026-08-26&end=2026-08-26").json()
    assert got[0]["completed"] is False


def test_full_round_trip_export_import_converges(client):
    """An export applied to the same data changes nothing and flags nothing —
    the fixed point every sync cycle should sit at."""
    make_task(client)
    data = export(client)
    before = client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()
    res = do_import(client, {**data, "since": data["now"]})
    assert res["conflicts"] == 0
    after = client.get("/api/tasks?start=2026-08-26&end=2026-08-26").json()
    assert before == after
