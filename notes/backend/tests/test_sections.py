from app import store


def test_empty_notebook_lists_nothing_of_the_users(user_tree):
    assert user_tree() == []


def test_create_section_makes_a_real_directory(client, notebook, user_tree):
    r = client.post("/api/notes/sections", json={"name": "Physics E M"})
    assert r.status_code == 200
    assert (notebook / "Physics E M").is_dir()
    assert [s["name"] for s in user_tree()] == ["Physics E M"]


def test_sections_get_distinct_colors(client, user_tree):
    for name in ("A", "B", "C"):
        client.post("/api/notes/sections", json={"name": name})
    colors = [s["color"] for s in user_tree()]
    assert len(set(colors)) == 3


def test_duplicate_name_is_suffixed_not_merged(client, notebook):
    client.post("/api/notes/sections", json={"name": "Other"})
    client.post("/api/notes/sections", json={"name": "Other"})
    assert sorted(p.name for p in notebook.iterdir() if p.is_dir()) == ["Other", "Other 2"]


def test_rename_keeps_pages_and_color(client, section, user_tree):
    client.post("/api/notes/pages", json={"section_id": section, "title": "Keeper"})
    before = user_tree()[0]["color"]
    r = client.put(f"/api/notes/sections/{section}", json={"name": "Renamed"})
    assert r.status_code == 200
    tree = user_tree()
    assert tree[0]["name"] == "Renamed"
    assert tree[0]["color"] == before
    assert [p["title"] for p in tree[0]["pages"]] == ["Keeper"]


def test_rename_onto_an_existing_section_is_409(client, section):
    client.post("/api/notes/sections", json={"name": "Taken"})
    r = client.put(f"/api/notes/sections/{section}", json={"name": "Taken"})
    assert r.status_code == 409


def test_delete_removes_the_directory_and_its_pages(client, section, notebook, user_tree):
    client.post("/api/notes/pages", json={"section_id": section, "title": "Doomed"})
    assert client.delete(f"/api/notes/sections/{section}").status_code == 200
    assert not (notebook / "Other").exists()
    assert user_tree() == []


def test_explicit_order_beats_alphabetical(client, user_tree):
    ids = [
        client.post("/api/notes/sections", json={"name": n}).json()["id"]
        for n in ("Alpha", "Beta", "Gamma")
    ]
    client.put("/api/notes/sections/order", json={"ids": [ids[2], ids[0], ids[1]]})
    assert [s["name"] for s in user_tree()] == ["Gamma", "Alpha", "Beta"]


def test_directory_made_outside_the_app_still_appears(client, notebook, user_tree):
    """The tree on disk is the source of truth; the sidecar only orders it."""
    (notebook / "Made By Hand").mkdir()
    assert "Made By Hand" in [s["name"] for s in user_tree()]


def test_losing_the_sidecar_costs_order_but_not_content(client, notebook, user_tree):
    for n in ("Zed", "Alpha"):
        client.post("/api/notes/sections", json={"name": n})
    client.put(
        "/api/notes/sections/order",
        json={"ids": [s["id"] for s in client.get("/api/notes/tree").json()][::-1]},
    )
    (notebook / store.META_NAME).unlink()
    # Both survive, now in the alphabetical fallback rather than the stored one.
    assert [s["name"] for s in user_tree()] == ["Alpha", "Zed"]


def test_dotfiles_are_not_sections(client, notebook, user_tree):
    (notebook / ".git").mkdir()
    assert user_tree() == []
