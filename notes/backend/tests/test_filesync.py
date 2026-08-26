"""The machine-sync surface: manifest, file get/put, tombstones, token auth."""
import pytest

TOKEN = "test-sync-token"


@pytest.fixture(autouse=True)
def sync_token(monkeypatch):
    monkeypatch.setenv("SYNC_TOKEN", TOKEN)


def hdr():
    return {"X-Sync-Token": TOKEN}


def make_page(client, section, title="Plan", content="hello"):
    page = client.post(
        "/api/notes/pages",
        json={"section_id": section, "title": title, "kind": "markdown"},
    ).json()
    client.put(f"/api/notes/pages/{page['id']}", json={"content": content})
    return page


# ------------------------------------------------------------------- auth

def test_sync_routes_refuse_wrong_or_missing_tokens(client):
    assert client.get("/api/notes/sync/manifest").status_code == 401
    r = client.get("/api/notes/sync/manifest", headers={"X-Sync-Token": "nope"})
    assert r.status_code == 401


def test_sync_routes_are_disabled_without_a_configured_token(client, monkeypatch):
    monkeypatch.delenv("SYNC_TOKEN")
    assert client.get("/api/notes/sync/manifest", headers=hdr()).status_code == 403


# --------------------------------------------------------------- manifest

def test_manifest_lists_pages_with_hashes(client, section):
    make_page(client, section)
    files = client.get("/api/notes/sync/manifest", headers=hdr()).json()["files"]
    entry = next(f for f in files if f["path"] == "Other/Plan.md")
    assert entry["sha"] and entry["size"] == 5 and entry["mtime"] > 0


def test_manifest_hides_internals_but_shows_meta_and_assets(client, section):
    make_page(client, section)
    files = {f["path"] for f in
             client.get("/api/notes/sync/manifest", headers=hdr()).json()["files"]}
    assert ".streaknotes.json" in files
    assert not any(p.startswith(".sync-tombstones") for p in files)


# ------------------------------------------------------------- get / put

def test_a_file_round_trips_with_its_mtime(client, section):
    make_page(client, section, content="round trip")
    r = client.get("/api/notes/sync/file",
                   params={"path": "Other/Plan.md"}, headers=hdr())
    assert r.status_code == 200 and r.content == b"round trip"
    mtime = float(r.headers["X-Mtime"])

    w = client.put("/api/notes/sync/file",
                   params={"path": "Copy/Plan.md", "mtime": str(mtime)},
                   content=r.content, headers=hdr())
    assert w.status_code == 200
    r2 = client.get("/api/notes/sync/file",
                    params={"path": "Copy/Plan.md"}, headers=hdr())
    assert r2.content == b"round trip"
    assert abs(float(r2.headers["X-Mtime"]) - mtime) < 0.001


def test_traversal_paths_are_rejected(client):
    for path in ("../evil.md", "/etc/passwd", "a/../../b.md", ".hidden/x.md"):
        r = client.get("/api/notes/sync/file", params={"path": path}, headers=hdr())
        assert r.status_code == 400, path


# ------------------------------------------------------------- tombstones

def test_deleting_a_page_records_a_tombstone(client, section):
    page = make_page(client, section)
    client.delete(f"/api/notes/pages/{page['id']}")
    tombs = client.get("/api/notes/sync/manifest", headers=hdr()).json()["tombstones"]
    assert "Other/Plan.md" in tombs


def test_renaming_a_page_tombstones_the_old_name(client, section):
    page = make_page(client, section)
    client.put(f"/api/notes/pages/{page['id']}", json={"title": "Plan B"})
    man = client.get("/api/notes/sync/manifest", headers=hdr()).json()
    assert "Other/Plan.md" in man["tombstones"]
    paths = {f["path"] for f in man["files"]}
    assert "Other/Plan B.md" in paths and "Other/Plan.md" not in paths
    # The renamed file must be newer than its old name's tombstone, or a
    # rename-back would be eaten by the tombstone on the next merge.
    entry = next(f for f in man["files"] if f["path"] == "Other/Plan B.md")
    assert entry["mtime"] >= man["tombstones"]["Other/Plan.md"] - 0.001


def test_sync_delete_removes_and_tombstones_at_the_given_time(client, section):
    import time

    make_page(client, section)
    # Recent but distinctive: a stamp older than the tombstone TTL (90 days)
    # would be pruned on write, which is intended behaviour, not a bug.
    ts = round(time.time() - 100, 3)
    r = client.delete("/api/notes/sync/file",
                      params={"path": "Other/Plan.md", "ts": str(ts)}, headers=hdr())
    assert r.status_code == 200
    man = client.get("/api/notes/sync/manifest", headers=hdr()).json()
    assert man["tombstones"]["Other/Plan.md"] == ts
    assert not any(f["path"] == "Other/Plan.md" for f in man["files"])


def test_an_incoming_write_clears_an_old_tombstone(client, section):
    page = make_page(client, section)
    client.delete(f"/api/notes/pages/{page['id']}")
    client.put("/api/notes/sync/file",
               params={"path": "Other/Plan.md", "mtime": "99999999999"},
               content=b"recreated elsewhere", headers=hdr())
    man = client.get("/api/notes/sync/manifest", headers=hdr()).json()
    assert "Other/Plan.md" not in man["tombstones"]
    assert any(f["path"] == "Other/Plan.md" for f in man["files"])
