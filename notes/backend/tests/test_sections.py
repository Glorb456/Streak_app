from app import store


def test_empty_notebook_lists_nothing(client):
    assert client.get("/api/notes/tree").json() == []


def test_create_section_makes_a_real_directory(client, notebook):
    r = client.post("/api/notes/sections", json={"name": "Physics E M"})
    assert r.status_code == 200
    assert (notebook / "Physics E M").is_dir()
    assert [s["name"] for s in client.get("/api/notes/tree").json()] == ["Physics E M"]


def test_sections_get_distinct_colors(client):
    for name in ("A", "B", "C"):
        client.post("/api/notes/sections", json={"name": name})
    colors = [s["color"] for s in client.get("/api/notes/tree").json()]
    assert len(set(colors)) == 3


def test_duplicate_name_is_suffixed_not_merged(client, notebook):
    client.post("/api/notes/sections", json={"name": "Other"})
    client.post("/api/notes/sections", json={"name": "Other"})
    assert sorted(p.name for p in notebook.iterdir() if p.is_dir()) == ["Other", "Other 2"]


def test_rename_keeps_pages_and_color(client, section):
    client.post("/api/notes/pages", json={"section_id": section, "title": "Keeper"})
    before = client.get("/api/notes/tree").json()[0]["color"]
    r = client.put(f"/api/notes/sections/{section}", json={"name": "Renamed"})
    assert r.status_code == 200
    tree = client.get("/api/notes/tree").json()
    assert tree[0]["name"] == "Renamed"
    assert tree[0]["color"] == before
    assert [p["title"] for p in tree[0]["pages"]] == ["Keeper"]


def test_rename_onto_an_existing_section_is_409(client, section):
    client.post("/api/notes/sections", json={"name": "Taken"})
    r = client.put(f"/api/notes/sections/{section}", json={"name": "Taken"})
    assert r.status_code == 409


def test_delete_removes_the_directory_and_its_pages(client, section, notebook):
    client.post("/api/notes/pages", json={"section_id": section, "title": "Doomed"})
    assert client.delete(f"/api/notes/sections/{section}").status_code == 200
    assert list(notebook.iterdir()) == [notebook / store.META_NAME]
    assert client.get("/api/notes/tree").json() == []


def test_explicit_order_beats_alphabetical(client):
    ids = [
        client.post("/api/notes/sections", json={"name": n}).json()["id"]
        for n in ("Alpha", "Beta", "Gamma")
    ]
    client.put("/api/notes/sections/order", json={"ids": [ids[2], ids[0], ids[1]]})
    assert [s["name"] for s in client.get("/api/notes/tree").json()] == [
        "Gamma", "Alpha", "Beta",
    ]


def test_directory_made_outside_the_app_still_appears(client, notebook):
    """The tree on disk is the source of truth; the sidecar only orders it."""
    (notebook / "Made By Hand").mkdir()
    assert "Made By Hand" in [s["name"] for s in client.get("/api/notes/tree").json()]


def test_losing_the_sidecar_costs_order_but_not_content(client, notebook):
    for n in ("Zed", "Alpha"):
        client.post("/api/notes/sections", json={"name": n})
    client.put(
        "/api/notes/sections/order",
        json={"ids": [s["id"] for s in client.get("/api/notes/tree").json()][::-1]},
    )
    (notebook / store.META_NAME).unlink()
    # Both survive, now in the alphabetical fallback rather than the stored one.
    assert [s["name"] for s in client.get("/api/notes/tree").json()] == ["Alpha", "Zed"]


def test_dotfiles_are_not_sections(client, notebook):
    (notebook / ".git").mkdir()
    assert client.get("/api/notes/tree").json() == []
