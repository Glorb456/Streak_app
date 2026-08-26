D = "2026-07-15"


def _first_daily_id(client):
    return client.get("/api/daily").json()[0]["id"]


def test_create_appends_with_next_position(client):
    d = client.post("/api/daily", json={"name": "Meditate", "color": "#abcdef"}).json()
    assert d["name"] == "Meditate"
    assert d["color"] == "#abcdef"
    assert d["position"] == 2  # seed filled 0..1
    assert d["active"] is True


def test_create_uses_default_color(client):
    d = client.post("/api/daily", json={"name": "Stretch"}).json()
    assert d["color"] == "#f9e2ce"


def test_update_changes_name(client):
    did = _first_daily_id(client)
    r = client.put(f"/api/daily/{did}", json={"name": "Workout", "color": "#000000"})
    assert r.status_code == 200
    assert r.json()["name"] == "Workout"


def test_delete_is_soft_and_hidden_from_list(client):
    did = _first_daily_id(client)
    assert client.delete(f"/api/daily/{did}").json() == {"ok": True}
    ids = [d["id"] for d in client.get("/api/daily").json()]
    assert did not in ids


def test_set_completion_and_read_back(client):
    did = _first_daily_id(client)
    r = client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": D, "completed": True},
    )
    assert r.status_code == 200
    assert r.json()["completed"] is True
    rng = client.get(f"/api/daily/completions?start={D}&end={D}").json()
    assert any(c["daily_task_id"] == did and c["completed"] for c in rng)


def test_set_completion_upserts_not_duplicates(client):
    did = _first_daily_id(client)
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": D, "completed": True},
    )
    r = client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": D, "completed": False},
    )
    assert r.json()["completed"] is False
    rng = client.get(f"/api/daily/completions?start={D}&end={D}").json()
    matches = [c for c in rng if c["daily_task_id"] == did]
    assert len(matches) == 1
    assert matches[0]["completed"] is False


def test_completions_range_filters_by_day(client):
    did = _first_daily_id(client)
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": "2026-07-15", "completed": True},
    )
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": "2026-08-15", "completed": True},
    )
    rng = client.get("/api/daily/completions?start=2026-07-01&end=2026-07-31").json()
    days = [c["day"] for c in rng]
    assert "2026-07-15" in days
    assert "2026-08-15" not in days


def test_update_missing_returns_404(client):
    r = client.put("/api/daily/999999", json={"name": "x", "color": "#111111"})
    assert r.status_code == 404


def test_completion_for_missing_daily_task_is_4xx(client):
    r = client.put(
        "/api/daily/completions",
        json={"daily_task_id": 999999, "day": D, "completed": True},
    )
    assert 400 <= r.status_code < 500


def test_soft_deleted_task_can_be_reactivated(client):
    did = _first_daily_id(client)
    client.delete(f"/api/daily/{did}")
    assert did not in [d["id"] for d in client.get("/api/daily").json()]
    r = client.put(
        f"/api/daily/{did}",
        json={"name": "Back", "color": "#f9e2ce", "active": True},
    )
    assert r.status_code == 200
    assert r.json()["active"] is True
    assert did in [d["id"] for d in client.get("/api/daily").json()]


def test_completions_of_soft_deleted_task_are_excluded(client):
    did = _first_daily_id(client)
    client.put(
        "/api/daily/completions",
        json={"daily_task_id": did, "day": D, "completed": True},
    )
    client.delete(f"/api/daily/{did}")
    rng = client.get(f"/api/daily/completions?start={D}&end={D}").json()
    assert all(c["daily_task_id"] != did for c in rng)


# ---------- weekday schedules (days_mask) ----------
# Bit 0 = Monday ... bit 6 = Sunday. 127 = every day.
MON = 1 << 0
WED = 1 << 2


def test_create_defaults_to_every_day(client):
    d = client.post("/api/daily", json={"name": "Stretch"}).json()
    assert d["days_mask"] == 127


def test_create_accepts_days_mask(client):
    d = client.post("/api/daily", json={"name": "Gym", "days_mask": MON | WED}).json()
    assert d["days_mask"] == MON | WED
    listed = [x for x in client.get("/api/daily").json() if x["id"] == d["id"]]
    assert listed[0]["days_mask"] == MON | WED


def test_update_changes_days_mask(client):
    did = _first_daily_id(client)
    r = client.put(
        f"/api/daily/{did}",
        json={"name": "Workout", "color": "#000000", "days_mask": MON},
    )
    assert r.status_code == 200
    assert r.json()["days_mask"] == MON


def test_update_accepts_an_empty_schedule(client):
    # A mask of 0 parks a task rather than being rejected or defaulted away.
    did = _first_daily_id(client)
    r = client.put(
        f"/api/daily/{did}",
        json={"name": "Paused", "color": "#000000", "days_mask": 0},
    )
    assert r.status_code == 200
    assert r.json()["days_mask"] == 0


def test_update_without_days_mask_resets_to_every_day(client):
    # PUT replaces the whole record, so an omitted mask falls back to the
    # schema default. The settings UI therefore always sends it; this pins the
    # behaviour so the trap is not rediscovered the hard way.
    did = _first_daily_id(client)
    client.put(
        f"/api/daily/{did}",
        json={"name": "Gym", "color": "#000000", "days_mask": MON},
    )
    r = client.put(f"/api/daily/{did}", json={"name": "Gym", "color": "#000000"})
    assert r.json()["days_mask"] == 127


def test_days_mask_out_of_range_is_rejected(client):
    r = client.post("/api/daily", json={"name": "Bad", "days_mask": 255})
    assert r.status_code == 422


def test_list_includes_days_mask(client):
    assert all("days_mask" in d for d in client.get("/api/daily").json())
