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
