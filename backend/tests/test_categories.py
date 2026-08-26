def test_list_returns_seeded(client):
    cats = client.get("/api/categories").json()
    assert len(cats) == 5


def test_create_appends_with_next_position(client):
    r = client.post("/api/categories", json={"name": "Work", "color": "#123456"})
    assert r.status_code == 200
    c = r.json()
    assert c["name"] == "Work"
    assert c["color"] == "#123456"
    # categories_create.sql uses MAX(position)+1; seed filled 0..4.
    assert c["position"] == 5
    assert client.get("/api/categories").json()[-1]["name"] == "Work"


def test_create_uses_default_color(client):
    c = client.post("/api/categories", json={"name": "Solo"}).json()
    assert c["color"] == "#7a7a7a"


def test_update_changes_name_and_color(client):
    cid = client.get("/api/categories").json()[0]["id"]
    r = client.put(
        f"/api/categories/{cid}", json={"name": "Maths", "color": "#000000"}
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Maths"
    assert r.json()["color"] == "#000000"
    assert r.json()["position"] == 0  # position preserved


def test_delete_removes_category(client):
    cid = client.get("/api/categories").json()[-1]["id"]
    assert client.delete(f"/api/categories/{cid}").json() == {"ok": True}
    remaining = [c["id"] for c in client.get("/api/categories").json()]
    assert cid not in remaining


def test_delete_nulls_tasks_category(client):
    """FK is ON DELETE SET NULL, so tasks survive a deleted category."""
    cid = client.get("/api/categories").json()[0]["id"]
    client.post(
        "/api/tasks",
        json={"description": "t", "due_date": "2026-07-15", "category_id": cid},
    )
    client.delete(f"/api/categories/{cid}")
    tasks = client.get("/api/tasks?start=2026-07-15&end=2026-07-15").json()
    assert tasks and tasks[0]["category_id"] is None


def test_update_missing_returns_404(client):
    r = client.put(
        "/api/categories/999999", json={"name": "x", "color": "#111111"}
    )
    assert r.status_code == 404
