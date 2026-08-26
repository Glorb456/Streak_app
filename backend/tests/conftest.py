"""Shared fixtures for the backend test suite.

Tests run against a *real* PostgreSQL database (the whole point of this app's
architecture is that its behaviour lives in the individual .sql files, so
mocking the DB would test nothing worth testing). The `client` fixture spins
up the FastAPI app once — triggering the lifespan that creates the pool and
runs the init/seed SQL — and `reset_db` returns the database to a clean,
freshly-seeded baseline before every test so tests are order-independent.
"""
import asyncio
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.db import DATABASE_URL, SQL_DIR
from app.main import app

INIT_FILES = sorted((SQL_DIR / "init").glob("*.sql"))
TABLES = (
    "categories, projects, tasks, daily_tasks, "
    "daily_task_completions, settings, "
    "sync_deletions, sync_conflicts, sync_peers"
)


async def _reset() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        try:
            await conn.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
        except asyncpg.UndefinedTableError:
            pass  # first run: init below creates the tables
        for path in INIT_FILES:
            await conn.execute(path.read_text())
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def client():
    # raise_server_exceptions=False so tests can assert on 500 responses
    # (used to document the missing-row update endpoints that currently blow
    # up instead of returning 404).
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_db(client):
    asyncio.run(_reset())
    yield
