import base64


def test_markdown_page_is_a_real_md_file(client, section, notebook):
    r = client.post(
        "/api/notes/pages",
        json={"section_id": section, "title": "PC ideas", "kind": "markdown"},
    )
    assert r.status_code == 200
    assert r.json()["kind"] == "markdown"
    assert (notebook / "Other" / "PC ideas.md").is_file()


def test_drawing_page_is_a_separate_kind(client, section, notebook, pages_in):
    r = client.post(
        "/api/notes/pages",
        json={"section_id": section, "title": "Sketch", "kind": "drawing"},
    )
    assert r.json()["kind"] == "drawing"
    assert (notebook / "Other" / "Sketch.draw.json").is_file()
    # The '.draw.json' suffix must win over the '.json' one, or a drawing
    # would be filed as some other kind — or as no page at all.
    page = pages_in(section)[0]
    assert (page["title"], page["kind"]) == ("Sketch", "drawing")


def test_unknown_kind_is_rejected(client, section):
    r = client.post(
        "/api/notes/pages", json={"section_id": section, "title": "x", "kind": "video"}
    )
    assert r.status_code == 400


def test_content_round_trips_to_disk(client, section, notebook):
    pid = client.post("/api/notes/pages", json={"section_id": section}).json()["id"]
    body = "# Title\n\nSome **words** here.\n"
    client.put(f"/api/notes/pages/{pid}", json={"content": body})
    assert (notebook / "Other" / "Untitled Page.md").read_text() == body
    assert client.get(f"/api/notes/pages/{pid}").json()["content"] == body


def test_rename_moves_the_file_and_keeps_the_body(client, section, notebook):
    pid = client.post("/api/notes/pages", json={"section_id": section}).json()["id"]
    client.put(f"/api/notes/pages/{pid}", json={"content": "kept"})
    r = client.put(f"/api/notes/pages/{pid}", json={"title": "Renamed"})
    assert r.status_code == 200
    assert (notebook / "Other" / "Renamed.md").read_text() == "kept"
    assert not (notebook / "Other" / "Untitled Page.md").exists()
    # The id is derived from the path, so a rename issues a new one and the
    # old id must stop resolving rather than serve a stale file.
    assert client.get(f"/api/notes/pages/{pid}").status_code == 404
    assert client.get(f"/api/notes/pages/{r.json()['id']}").json()["content"] == "kept"


def test_rename_onto_an_existing_page_is_409(client, section):
    client.post("/api/notes/pages", json={"section_id": section, "title": "Taken"})
    pid = client.post(
        "/api/notes/pages", json={"section_id": section, "title": "Other"}
    ).json()["id"]
    assert client.put(f"/api/notes/pages/{pid}", json={"title": "Taken"}).status_code == 409


def test_delete_removes_the_file(client, section, notebook):
    pid = client.post("/api/notes/pages", json={"section_id": section}).json()["id"]
    assert client.delete(f"/api/notes/pages/{pid}").status_code == 200
    assert not (notebook / "Other" / "Untitled Page.md").exists()


def test_new_pages_land_at_the_bottom_of_the_section(client, section, pages_in):
    for t in ("Zeta", "Alpha"):
        client.post("/api/notes/pages", json={"section_id": section, "title": t})
    assert [p["title"] for p in pages_in(section)] == ["Zeta", "Alpha"]


def test_page_order_can_be_rewritten(client, section, pages_in):
    ids = [
        client.post(
            "/api/notes/pages", json={"section_id": section, "title": t}
        ).json()["id"]
        for t in ("One", "Two", "Three")
    ]
    client.put(
        f"/api/notes/sections/{section}/pages/order", json={"ids": ids[::-1]}
    )
    assert [p["title"] for p in pages_in(section)] == ["Three", "Two", "One"]


def test_md_file_dropped_in_by_hand_is_a_page(client, section, notebook, pages_in):
    (notebook / "Other" / "Dropped.md").write_text("written elsewhere")
    pages = pages_in(section)
    assert [p["title"] for p in pages] == ["Dropped"]
    assert pages[0]["snippet"] == "written elsewhere"


def test_unrelated_files_are_not_pages(client, section, notebook, pages_in):
    (notebook / "Other" / "photo.png").write_bytes(b"\x89PNG")
    (notebook / "Other" / ".hidden.md").write_text("x")
    assert pages_in(section) == []


def test_oversize_page_is_rejected(client, section):
    pid = client.post("/api/notes/pages", json={"section_id": section}).json()["id"]
    r = client.put(f"/api/notes/pages/{pid}", json={"content": "x" * (5 * 1024 * 1024 + 1)})
    assert r.status_code == 413


def _ident(rel: str) -> str:
    return base64.urlsafe_b64encode(rel.encode()).decode().rstrip("=")


def test_traversal_ids_are_refused(client, section, tmp_path):
    """Ids are paths, so this is the one place traversal has to be stopped."""
    secret = tmp_path / "secret.md"
    secret.write_text("password")
    for rel in ("../secret.md", "Other/../../secret.md", "/etc/passwd", "..", "."):
        assert client.get(f"/api/notes/pages/{_ident(rel)}").status_code == 404
    assert client.delete(f"/api/notes/pages/{_ident('../secret.md')}").status_code == 404
    assert secret.exists()


def test_a_symlink_out_of_the_notebook_is_refused(client, notebook, tmp_path):
    outside = tmp_path / "outside.md"
    outside.write_text("password")
    (notebook / "Other").mkdir(exist_ok=True)
    (notebook / "Other" / "Escape.md").symlink_to(outside)
    assert client.get(f"/api/notes/pages/{_ident('Other/Escape.md')}").status_code == 404


def test_malformed_id_is_404_not_500(client):
    assert client.get("/api/notes/pages/not-base64!!").status_code == 404


def test_title_with_path_separators_cannot_escape(client, section, notebook):
    r = client.post(
        "/api/notes/pages", json={"section_id": section, "title": "../../pwned"}
    )
    assert r.status_code == 200
    assert not (notebook.parent / "pwned.md").exists()
    assert (notebook / "Other" / "pwned.md").is_file()


def test_title_that_sanitises_to_nothing_is_rejected(client, section):
    r = client.post("/api/notes/pages", json={"section_id": section, "title": "///"})
    assert r.status_code == 400
