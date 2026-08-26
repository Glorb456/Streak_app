"""Optimistic concurrency: what keeps a drawing open on two devices safe."""


def make_page(client, section, kind="drawing"):
    return client.post(
        "/api/notes/pages", json={"section_id": section, "title": "Sketch", "kind": kind}
    ).json()


def test_a_new_drawing_is_a_valid_empty_document(client, section):
    page = make_page(client, section)
    assert '"format":"streaknotes.draw"' in page["content"]
    assert '"elements":[]' in page["content"]


def test_reading_a_page_gives_an_etag_that_tracks_content(client, section):
    page = make_page(client, section)
    assert page["etag"]
    client.put(f"/api/notes/pages/{page['id']}", json={"content": "changed"})
    assert client.get(f"/api/notes/pages/{page['id']}").json()["etag"] != page["etag"]


def test_saving_at_the_current_etag_succeeds(client, section):
    page = make_page(client, section)
    r = client.put(
        f"/api/notes/pages/{page['id']}", json={"content": "v2", "if_match": page["etag"]}
    )
    assert r.status_code == 200
    assert r.json()["etag"] != page["etag"]


def test_a_stale_save_is_refused_and_hands_back_the_current_page(client, section):
    page = make_page(client, section)
    # The other device saves first.
    client.put(f"/api/notes/pages/{page['id']}", json={"content": "from the iPad"})
    # This device still holds the old etag.
    r = client.put(
        f"/api/notes/pages/{page['id']}",
        json={"content": "from the desktop", "if_match": page["etag"]},
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    # The current page rides back so the client merges and retries in one hop.
    assert detail["current"]["content"] == "from the iPad"
    assert detail["current"]["etag"]
    # And nothing was overwritten.
    assert client.get(f"/api/notes/pages/{page['id']}").json()["content"] == "from the iPad"


def test_retrying_with_the_returned_etag_lands(client, section):
    page = make_page(client, section)
    client.put(f"/api/notes/pages/{page['id']}", json={"content": "theirs"})
    conflict = client.put(
        f"/api/notes/pages/{page['id']}", json={"content": "mine", "if_match": page["etag"]}
    ).json()["detail"]["current"]
    r = client.put(
        f"/api/notes/pages/{page['id']}",
        json={"content": "merged", "if_match": conflict["etag"]},
    )
    assert r.status_code == 200
    assert client.get(f"/api/notes/pages/{page['id']}").json()["content"] == "merged"


def test_a_save_without_if_match_still_overwrites(client, section):
    """Markdown pages have one editor and must not start failing on races."""
    page = make_page(client, section, kind="markdown")
    client.put(f"/api/notes/pages/{page['id']}", json={"content": "a"})
    r = client.put(f"/api/notes/pages/{page['id']}", json={"content": "b"})
    assert r.status_code == 200
    assert client.get(f"/api/notes/pages/{page['id']}").json()["content"] == "b"


def test_a_save_that_changes_nothing_is_not_a_conflict(client, section):
    """Two devices writing identical bytes have nothing to reconcile."""
    page = make_page(client, section)
    client.put(f"/api/notes/pages/{page['id']}", json={"content": page["content"]})
    r = client.put(
        f"/api/notes/pages/{page['id']}",
        json={"content": "next", "if_match": page["etag"]},
    )
    assert r.status_code == 200


def test_renaming_a_drawing_keeps_its_strokes(client, section):
    page = make_page(client, section)
    client.put(f"/api/notes/pages/{page['id']}", json={"content": '{"rev":9}'})
    renamed = client.put(f"/api/notes/pages/{page['id']}", json={"title": "Skulk idea"}).json()
    assert renamed["content"] == '{"rev":9}'
    assert renamed["kind"] == "drawing"
