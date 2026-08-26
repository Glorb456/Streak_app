"""Database pool + loader that executes the individual .sql files.

Every query the API runs lives in app/sql/queries/<name>.sql and is looked
up by name; schema/seed files in app/sql/init/ run in order at startup.
"""
import asyncio
import os
from pathlib import Path

import asyncpg

DATABASE_URL = os.environ["DATABASE_URL"]
SQL_DIR = Path(__file__).parent / "sql"

_pool: asyncpg.Pool | None = None
_query_cache: dict[str, str] = {}


def sql(name: str) -> str:
    """Return the SQL text of app/sql/queries/<name>.sql (cached)."""
    if name not in _query_cache:
        _query_cache[name] = (SQL_DIR / "queries" / f"{name}.sql").read_text()
    return _query_cache[name]


def pool() -> asyncpg.Pool:
    assert _pool is not None, "database not initialised"
    return _pool


async def connect_and_init() -> None:
    global _pool
    last_err: Exception | None = None
    for _ in range(30):
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
            break
        except (OSError, asyncpg.PostgresError) as e:
            last_err = e
            await asyncio.sleep(1)
    else:
        raise RuntimeError(f"could not connect to database: {last_err}")

    async with _pool.acquire() as conn:
        for path in sorted((SQL_DIR / "init").glob("*.sql")):
            await conn.execute(path.read_text())


async def close() -> None:
    if _pool is not None:
        await _pool.close()
