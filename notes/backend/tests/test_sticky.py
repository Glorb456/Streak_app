"""The app-owned sticky-notes section.

The Streak task app's floating sticky-note widget writes here, so this section
has to behave like infrastructure rather than like a folder the user happens to
have: always present, never removable, and holding only what the widget can
open.
"""
from app import store


def test_it_appears_on_first_read_of_an_empty_notebook(client, notebook):
    assert not (notebook / store.STICKY_SECTION).exists()
    tree = client.get("/api/notes/tree").json()
    assert [s["name"] for s in tree] == [store.STICKY_SECTION]
    assert (notebook / store.STICKY_SECTION).is_dir()


def test_it_comes_back_if_the_directory_is_removed_by_hand(client, notebook, sticky):
    client.get("/api/notes/tree")
    (notebook / store.STICKY_SECTION).rmdir()
    assert sticky()["name"] == store.STICKY_SECTION
    assert (notebook / store.STICKY_SECTION).is_dir()


def test_it_is_flagged_so_both_frontends_agree(client, section, sticky):
    tree = client.get("/api/notes/tree").json()
    assert [s["sticky"] for s in tree if s["name"] == store.STICKY_SECTION] == [True]
    assert [s["sticky"] for s in tree if s["name"] == "Other"] == [False]


def test_it_sorts_to_the_top(client):
    for n in ("Aardvark", "Baja"):
        client.post("/api/notes/sections", json={"name": n})
    assert client.get("/api/notes/tree").json()[0]["name"] == store.STICKY_SECTION


def test_it_cannot_be_deleted(client, sticky, notebook):
    r = client.delete(f"/api/notes/sections/{sticky()['id']}")
    assert r.status_code == 403
    assert (notebook / store.STICKY_SECTION).is_dir()


def test_it_cannot_be_renamed_away(client, sticky):
    """Renaming it is the same loss as deleting it: the app would make a new
    one and every existing sticky note would be stranded in the orphan."""
    r = client.put(f"/api/notes/sections/{sticky()['id']}", json={"name": "Junk"})
    assert r.status_code == 403
    assert sticky()["name"] == store.STICKY_SECTION


def test_its_colour_can_still_be_changed(client, sticky):
    r = client.put(f"/api/notes/sections/{sticky()['id']}", json={"color": "#00ff00"})
    assert r.status_code == 200
    assert sticky()["color"] == "#00ff00"


def test_a_sticky_note_is_an_ordinary_markdown_file(client, sticky, notebook):
    r = client.post(
        "/api/notes/pages",
        json={"section_id": sticky()["id"], "title": "Milk and eggs", "kind": "markdown"},
    )
    assert r.status_code == 200
    assert (notebook / store.STICKY_SECTION / "Milk and eggs.md").is_file()


def test_a_drawing_cannot_be_put_in_it(client, sticky):
    # The widget can only open markdown, so a drawing here would be a page it
    # could never show.
    r = client.post(
        "/api/notes/pages",
        json={"section_id": sticky()["id"], "title": "Sketch", "kind": "drawing"},
    )
    assert r.status_code == 400
    assert sticky()["pages"] == []


def test_the_notes_inside_it_can_be_deleted(client, sticky):
    pid = client.post(
        "/api/notes/pages", json={"section_id": sticky()["id"], "title": "Temporary"}
    ).json()["id"]
    assert client.delete(f"/api/notes/pages/{pid}").status_code == 200
    assert sticky()["pages"] == []


def test_a_sticky_note_carries_a_checklist_in_the_task_apps_encoding(client, sticky, notebook):
    """The same '- [ ]' lines the task popup already writes, so a note reads
    the same in the widget, in Streak Notes and in any other editor."""
    pid = client.post(
        "/api/notes/pages", json={"section_id": sticky()["id"], "title": "Shopping"}
    ).json()["id"]
    body = "Shopping\n- [ ] milk\n- [x] eggs\n"
    client.put(f"/api/notes/pages/{pid}", json={"content": body})
    assert (notebook / store.STICKY_SECTION / "Shopping.md").read_text() == body
    assert sticky()["pages"][0]["snippet"] == "Shopping milk eggs"


def test_a_sticky_note_can_be_renamed_as_its_first_line_changes(client, sticky):
    """The widget titles a note from its first line, the way the old Notes app
    did, so retitling has to move the file."""
    pid = client.post(
        "/api/notes/pages", json={"section_id": sticky()["id"], "title": "New Note"}
    ).json()["id"]
    r = client.put(
        f"/api/notes/pages/{pid}",
        json={"title": "Anyone missing the old Notes", "content": "Anyone missing the old Notes\n"},
    )
    assert r.status_code == 200
    assert [p["title"] for p in sticky()["pages"]] == ["Anyone missing the old Notes"]
