"""The startup seed (app/sql/init/002_seed.sql) is the app's out-of-the-box
state; these lock in that it produces exactly what the UI expects."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_seed_categories(client):
    cats = client.get("/api/categories").json()
    assert [c["name"] for c in cats] == [
        "Math", "History", "Science", "Gym", "Personal",
    ]
    assert [c["position"] for c in cats] == [0, 1, 2, 3, 4]
    assert cats[0]["color"] == "#4caf50"


def test_seed_daily_tasks(client):
    daily = client.get("/api/daily").json()
    assert [d["name"] for d in daily] == ["Exercise", "Read 30 min"]
    assert all(d["active"] for d in daily)
    assert [d["position"] for d in daily] == [0, 1]


def test_seed_settings(client):
    s = client.get("/api/settings").json()
    assert s["background_color"] == "#191919"
    # The internal 'seeded' bookkeeping flag is not exposed to the client.
    assert "seeded" not in s
