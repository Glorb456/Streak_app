"""Fixtures for the notebook API tests.

The store is a filesystem, not a database, so each test gets a real empty
directory as the notebook root — the point of this app's architecture is that
its behaviour lives in the tree on disk, and a mocked filesystem would test
nothing worth testing.
"""
import pytest
from fastapi.testclient import TestClient

from app import store
from app.main import app


@pytest.fixture(autouse=True)
def notebook(tmp_path, monkeypatch):
    root = tmp_path / "notebook"
    root.mkdir()
    monkeypatch.setattr(store, "ROOT", root)
    yield root


@pytest.fixture
def client(notebook):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def section(client):
    """A section to hang pages off, returned as its API id."""
    return client.post("/api/notes/sections", json={"name": "Other"}).json()["id"]


@pytest.fixture
def user_tree(client):
    """The tree minus the app-owned sticky section.

    Reading the notebook now materialises "Sticky Notes" if it is missing, so
    tests about what the *user* has made filter it out; the tests that are
    about the sticky section itself look for it directly.
    """
    return lambda: [s for s in client.get("/api/notes/tree").json() if not s["sticky"]]


@pytest.fixture
def pages_in(client):
    """The pages of one section, looked up by id.

    Index 0 of the tree is no longer "the section this test made" now that the
    sticky section always sorts above it.
    """
    def _get(section_id):
        tree = client.get("/api/notes/tree").json()
        return next(s for s in tree if s["id"] == section_id)["pages"]
    return _get


@pytest.fixture
def sticky(client):
    """The app-owned sticky section, as the API reports it."""
    return lambda: next(s for s in client.get("/api/notes/tree").json() if s["sticky"])
