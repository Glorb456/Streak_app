def test_get_returns_dict(client):
    s = client.get("/api/settings").json()
    assert isinstance(s, dict)
    assert "background_color" in s


def test_set_new_key(client):
    r = client.put("/api/settings", json={"key": "accent", "value": "blue"})
    assert r.status_code == 200
    assert r.json() == {"accent": "blue"}
    assert client.get("/api/settings").json()["accent"] == "blue"


def test_set_overwrites_existing_key(client):
    client.put("/api/settings", json={"key": "background_color", "value": "#ffffff"})
    assert client.get("/api/settings").json()["background_color"] == "#ffffff"
