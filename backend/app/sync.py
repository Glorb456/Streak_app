"""Multi-node sync: export/import merging, and the background engine.

Topology is a star. Every node runs this same stack; the *host* is the hub and
runs no sync loop of its own. Each *backup* node (same owner, fast interval)
and each buddy *mirror* node (other machine, slow interval) runs the engine
loop here, which every cycle:

    1. pulls the host's changes since its last pull and merges them in,
    2. pushes its own changes since its last push to the host,
    3. does the same for the notes notebook, file by file.

Rows are addressed by `uid` (never by serial id, which stays node-local) and
merged last-writer-wins on `updated_at`. When both sides changed a row since
the last sync, the newer version wins immediately — the app never blocks on a
conflict — and the losing version is stored in sync_conflicts for the
bare-bones resolver in the web UI.

Timestamps are compared across machines, so nodes should run NTP (any stock
OS does). Watermarks are taken with a few seconds of slack and re-applied
rows are skipped on equal timestamps, so the overlap costs nothing.

House-style note: the app's own queries each live in app/sql/queries/*.sql.
The sync queries are instead generated from SYNCED_TABLES below — they are
one uniform statement per table, and keeping them table-driven is what
guarantees a future column can't be forgotten in one of eight files.
"""
import asyncio
import base64
import datetime as dt
import json
import logging
import os
import uuid as uuidlib

from . import db

log = logging.getLogger("streak.sync")

def _int_env(name: str, default: int) -> int:
    # Compose passes unset optionals through as empty strings; treat those
    # (and any other junk) as "use the default" rather than failing to boot.
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


SYNC_ROLE = os.environ.get("SYNC_ROLE", "")           # host | backup | mirror | ""
SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "")
SYNC_UPSTREAM = os.environ.get("SYNC_UPSTREAM", "").rstrip("/")
SYNC_INTERVAL = _int_env("SYNC_INTERVAL", 600 if SYNC_ROLE == "mirror" else 30)
NOTES_INTERNAL_URL = os.environ.get("NOTES_INTERNAL_URL", "").rstrip("/")

# Optional encrypted buddy snapshots (host role): see blob_job below.
BUDDY_BLOB_URL = os.environ.get("BUDDY_BLOB_URL", "").rstrip("/")
BUDDY_BLOB_KEY = os.environ.get("BUDDY_BLOB_KEY", "")
BUDDY_BLOB_TOKEN = os.environ.get("BUDDY_BLOB_TOKEN", "")
BLOB_INTERVAL = _int_env("BLOB_INTERVAL", 6 * 3600)
BLOB_DIR = os.environ.get("BLOB_DIR", "/blobs")
BLOB_KEEP = _int_env("BLOB_KEEP", 14)

# Watermark slack: a transaction that committed while an export was running
# can carry an updated_at a little older than the export's now(). Handing the
# watermark back slightly in the past re-sends that window next cycle, and
# equal-timestamp rows are skipped on apply, so the overlap is free.
SLACK = dt.timedelta(seconds=10)

# ------------------------------------------------------------ table registry

# (name, {field: kind}, {fk_column: referenced_table}) in dependency order —
# parents before children so an import can resolve FK uids as it goes.
# kind: 's' str, 'i' int, 'b' bool, 'd' date, 't' timestamptz.
SYNCED_TABLES = [
    ("categories",  {"name": "s", "color": "s", "position": "i"}, {}),
    ("projects",    {"name": "s", "created_at": "t"}, {"category_id": "categories"}),
    ("daily_tasks", {"name": "s", "color": "s", "position": "i",
                     "active": "b", "days_mask": "i"}, {}),
    ("tasks",       {"description": "s", "notes": "s", "due_date": "d",
                     "done": "b", "created_at": "t", "position": "i"},
                    {"category_id": "categories", "project_id": "projects"}),
]


def _enc(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, uuidlib.UUID):
        return str(v)
    return v


def _dec(kind, v):
    if v is None:
        return None
    if kind == "d":
        return dt.date.fromisoformat(v)
    if kind == "t":
        return dt.datetime.fromisoformat(v)
    return v


def _ts(v):
    return dt.datetime.fromisoformat(v) if isinstance(v, str) else v


# ------------------------------------------------------------------- export

async def export_changes(conn, since: dt.datetime | None) -> dict:
    """Everything changed since `since` (None = everything), JSON-safe."""
    out = {"tables": {}, "completions": [], "settings": [], "deletions": []}
    for name, fields, fks in SYNCED_TABLES:
        cols = ", ".join(f"t.{f}" for f in fields)
        fkcols = "".join(
            f", (SELECT r.uid FROM {ref} r WHERE r.id = t.{col}) AS {col[:-3]}_uid"
            for col, ref in fks.items()
        )
        rows = await conn.fetch(
            f"SELECT t.uid, t.updated_at, {cols}{fkcols} FROM {name} t "
            f"WHERE $1::timestamptz IS NULL OR t.updated_at > $1",
            since,
        )
        out["tables"][name] = [{k: _enc(v) for k, v in r.items()} for r in rows]

    rows = await conn.fetch(
        "SELECT d.uid AS daily_task_uid, c.day, c.completed, c.updated_at "
        "FROM daily_task_completions c JOIN daily_tasks d ON d.id = c.daily_task_id "
        "WHERE $1::timestamptz IS NULL OR c.updated_at > $1",
        since,
    )
    out["completions"] = [{k: _enc(v) for k, v in r.items()} for r in rows]

    rows = await conn.fetch(
        "SELECT key, value, updated_at FROM settings "
        "WHERE $1::timestamptz IS NULL OR updated_at > $1",
        since,
    )
    out["settings"] = [{k: _enc(v) for k, v in r.items()} for r in rows]

    rows = await conn.fetch(
        "SELECT tbl, uid, deleted_at FROM sync_deletions "
        "WHERE $1::timestamptz IS NULL OR deleted_at > $1",
        since,
    )
    out["deletions"] = [{k: _enc(v) for k, v in r.items()} for r in rows]

    now = await conn.fetchval("SELECT now()")
    out["now"] = _enc(now - SLACK)
    return out


# ------------------------------------------------------------------- import

async def _conflict(conn, tbl, uid, kept, lost, peer):
    await conn.execute(
        "INSERT INTO sync_conflicts (tbl, uid, kept, lost, peer) "
        "VALUES ($1, $2, $3, $4, $5)",
        tbl, str(uid), json.dumps(kept, default=_enc), json.dumps(lost, default=_enc), peer,
    )


async def import_changes(conn, payload: dict, peer: str = "") -> dict:
    """Merge a peer's export into this node's database.

    `payload["since"]` is the sender's watermark — the last moment the two
    databases were known to agree — and is what tells an ordinary overwrite
    (only one side changed) apart from a conflict (both sides changed).
    Runs in one transaction with streak.sync on, so applied rows keep the
    peer's timestamps instead of being re-stamped and echoing forever.
    """
    since = _ts(payload.get("since")) if payload.get("since") else None
    applied = conflicts = 0

    def both_changed(local_updated):
        return since is not None and local_updated > since

    async with conn.transaction():
        await conn.execute("SET LOCAL streak.sync = 'on'")

        for name, fields, fks in SYNCED_TABLES:
            for row in payload.get("tables", {}).get(name, []):
                uid = row["uid"]
                incoming_at = _ts(row["updated_at"])
                incoming = {f: row.get(f) for f in fields}

                tomb = await conn.fetchrow(
                    "SELECT deleted_at FROM sync_deletions WHERE tbl=$1 AND uid=$2",
                    name, uuidlib.UUID(uid),
                )
                local = await conn.fetchrow(
                    f"SELECT * FROM {name} WHERE uid = $1", uuidlib.UUID(uid)
                )

                if local is None:
                    if tomb and tomb["deleted_at"] >= incoming_at:
                        continue  # deleted here after that edit: stays deleted
                    cols = ["uid", "updated_at", *fields, *fks]
                    vals = [uuidlib.UUID(uid), incoming_at,
                            *(_dec(fields[f], row.get(f)) for f in fields)]
                    ph = [f"${i+1}" for i in range(len(vals))]
                    for col, ref in fks.items():
                        vals.append(row.get(f"{col[:-3]}_uid"))
                        ph.append(f"(SELECT id FROM {ref} WHERE uid = ${len(vals)}::uuid)")
                    await conn.execute(
                        f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({', '.join(ph)})",
                        *vals,
                    )
                    applied += 1
                    if tomb:  # edit newer than the local delete: resurrected
                        await _conflict(conn, name, uid, incoming,
                                        {"deleted_at": _enc(tomb["deleted_at"])}, peer)
                        conflicts += 1
                    continue

                local_at = local["updated_at"]
                local_ser = {f: _enc(local[f]) for f in fields}
                if incoming_at <= local_at:
                    # Local copy is as new or newer. Equal timestamps mean the
                    # same edit came back around; skip silently.
                    if incoming_at < local_at and local_ser != {f: _enc(_dec(fields[f], incoming[f])) for f in fields} \
                            and both_changed(incoming_at):
                        await _conflict(conn, name, uid, local_ser, incoming, peer)
                        conflicts += 1
                    continue

                sets, vals = [], []
                vals.append(incoming_at)
                sets.append(f"updated_at = ${len(vals)}")
                for f in fields:
                    vals.append(_dec(fields[f], row.get(f)))
                    sets.append(f"{f} = ${len(vals)}")
                for col, ref in fks.items():
                    vals.append(row.get(f"{col[:-3]}_uid"))
                    sets.append(f"{col} = (SELECT id FROM {ref} WHERE uid = ${len(vals)}::uuid)")
                vals.append(uuidlib.UUID(uid))
                await conn.execute(
                    f"UPDATE {name} SET {', '.join(sets)} WHERE uid = ${len(vals)}", *vals
                )
                applied += 1
                if both_changed(local_at) and local_ser != incoming:
                    await _conflict(conn, name, uid, incoming, local_ser, peer)
                    conflicts += 1

        for row in payload.get("completions", []):
            incoming_at = _ts(row["updated_at"])
            day = _dec("d", row["day"])
            parent = await conn.fetchval(
                "SELECT id FROM daily_tasks WHERE uid = $1",
                uuidlib.UUID(row["daily_task_uid"]),
            )
            if parent is None:
                continue  # parent daily task genuinely absent on this node
            local = await conn.fetchrow(
                "SELECT completed, updated_at FROM daily_task_completions "
                "WHERE daily_task_id = $1 AND day = $2", parent, day,
            )
            if local is not None and incoming_at <= local["updated_at"]:
                continue
            await conn.execute(
                "INSERT INTO daily_task_completions (daily_task_id, day, completed, updated_at) "
                "VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (daily_task_id, day) "
                "DO UPDATE SET completed = $3, updated_at = $4",
                parent, day, row["completed"], incoming_at,
            )
            applied += 1

        for row in payload.get("settings", []):
            incoming_at = _ts(row["updated_at"])
            local = await conn.fetchrow(
                "SELECT value, updated_at FROM settings WHERE key = $1", row["key"]
            )
            if local is not None and incoming_at <= local["updated_at"]:
                continue
            if local is not None and both_changed(local["updated_at"]) \
                    and local["value"] != row["value"]:
                await _conflict(conn, "settings", row["key"],
                                {"value": row["value"]}, {"value": local["value"]}, peer)
                conflicts += 1
            await conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) "
                "ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
                row["key"], row["value"], incoming_at,
            )
            applied += 1

        for row in payload.get("deletions", []):
            tbl, uid = row["tbl"], uuidlib.UUID(row["uid"])
            deleted_at = _ts(row["deleted_at"])
            if tbl not in {t[0] for t in SYNCED_TABLES}:
                continue
            local = await conn.fetchrow(f"SELECT * FROM {tbl} WHERE uid = $1", uid)
            if local is not None:
                if local["updated_at"] > deleted_at:
                    # Edited here after it was deleted there: the edit wins,
                    # the delete is surfaced as a conflict.
                    fields = next(f for n, f, _ in SYNCED_TABLES if n == tbl)
                    await _conflict(conn, tbl, str(uid),
                                    {f: _enc(local[f]) for f in fields},
                                    {"deleted_at": _enc(deleted_at)}, peer)
                    conflicts += 1
                    continue
                await conn.execute(f"DELETE FROM {tbl} WHERE uid = $1", uid)
                applied += 1
            await conn.execute(
                "INSERT INTO sync_deletions (tbl, uid, deleted_at) VALUES ($1, $2, $3) "
                "ON CONFLICT (tbl, uid) DO UPDATE "
                "SET deleted_at = GREATEST(sync_deletions.deleted_at, $3)",
                tbl, uid, deleted_at,
            )

    now = await conn.fetchval("SELECT now()")
    return {"applied": applied, "conflicts": conflicts, "now": _enc(now - SLACK)}


# ----------------------------------------------------------------- conflicts

RESTORE_ORDER = [t[0] for t in SYNCED_TABLES]


async def restore_conflict(conn, conflict_id: int) -> bool:
    """Put a conflict's losing version back (as a fresh, propagating edit)."""
    row = await conn.fetchrow("SELECT * FROM sync_conflicts WHERE id = $1", conflict_id)
    if row is None:
        return False
    tbl, uid, lost = row["tbl"], row["uid"], json.loads(row["lost"])

    if tbl == "settings":
        await conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) "
            "ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()",
            uid, lost["value"],
        )
    elif tbl in RESTORE_ORDER and "deleted_at" not in lost:
        fields = next(f for n, f, _ in SYNCED_TABLES if n == tbl)
        exists = await conn.fetchval(
            f"SELECT 1 FROM {tbl} WHERE uid = $1", uuidlib.UUID(uid)
        )
        vals = [_dec(fields[f], lost.get(f)) for f in fields]
        if exists:
            sets = ", ".join(f"{f} = ${i+1}" for i, f in enumerate(fields))
            await conn.execute(
                f"UPDATE {tbl} SET {sets}, updated_at = now() "
                f"WHERE uid = ${len(vals)+1}", *vals, uuidlib.UUID(uid),
            )
        else:
            cols = ", ".join(["uid", *fields])
            ph = ", ".join(f"${i+1}" for i in range(len(vals) + 1))
            await conn.execute(
                f"INSERT INTO {tbl} ({cols}) VALUES ({ph})",
                uuidlib.UUID(uid), *vals,
            )
            # A restore of a deleted row must also retire the tombstone, or
            # the delete would win again on the next merge.
            await conn.execute(
                "DELETE FROM sync_deletions WHERE tbl = $1 AND uid = $2",
                tbl, uuidlib.UUID(uid),
            )
    elif "deleted_at" in lost:
        # The lost side was a deletion: re-apply it, now as a fresh delete.
        await conn.execute(f"DELETE FROM {tbl} WHERE uid = $1", uuidlib.UUID(uid))

    await conn.execute(
        "UPDATE sync_conflicts SET resolved = TRUE WHERE id = $1", conflict_id
    )
    return True


# ------------------------------------------------------------------- engine

status: dict = {
    "role": SYNC_ROLE,
    "upstream": SYNC_UPSTREAM,
    "interval": SYNC_INTERVAL,
    "last_ok": None,
    "last_error": None,
    "upstream_reachable": None,
}
_wake = asyncio.Event()


def request_sync_now():
    _wake.set()


def _client():
    import httpx  # imported lazily: not needed on plain single-node installs

    return httpx.AsyncClient(
        headers={"X-Sync-Token": SYNC_TOKEN}, timeout=60, follow_redirects=False
    )


async def _get_peer(conn, peer):
    row = await conn.fetchrow("SELECT * FROM sync_peers WHERE peer = $1", peer)
    if row is None:
        await conn.execute("INSERT INTO sync_peers (peer) VALUES ($1)", peer)
        return {"last_pull": None, "last_push": None}
    return dict(row)


async def sync_cycle():
    """One pull+push round with the upstream node, tasks DB then notes."""
    async with db.pool().acquire() as conn:
        marks = await _get_peer(conn, SYNC_UPSTREAM)

        async with _client() as http:
            # Pull: host's changes since our last pull, merged in locally.
            r = await http.get(
                f"{SYNC_UPSTREAM}/api/sync/peer/export",
                params={"since": _enc(marks["last_pull"]) or ""},
            )
            r.raise_for_status()
            payload = r.json()
            payload["since"] = _enc(marks["last_pull"])
            await import_changes(conn, payload, peer=SYNC_UPSTREAM)
            await conn.execute(
                "UPDATE sync_peers SET last_pull = $2 WHERE peer = $1",
                SYNC_UPSTREAM, _ts(payload["now"]),
            )

            # Push: our changes since our last push. The watermark is taken
            # from the database clock *before* the export so nothing written
            # mid-cycle can fall between the cracks.
            t0 = await conn.fetchval("SELECT now()") - SLACK
            out = await export_changes(conn, marks["last_push"])
            out["since"] = _enc(marks["last_push"])
            r = await http.post(f"{SYNC_UPSTREAM}/api/sync/peer/import", json=out)
            r.raise_for_status()
            await conn.execute(
                "UPDATE sync_peers SET last_push = $2 WHERE peer = $1",
                SYNC_UPSTREAM, t0,
            )

            if NOTES_INTERNAL_URL:
                from . import notesync

                await notesync.sync_notes(
                    http,
                    local=f"{NOTES_INTERNAL_URL}/api/notes/sync",
                    remote=f"{SYNC_UPSTREAM}/api/notes/sync",
                )


async def engine_loop():
    log.info("sync engine: role=%s upstream=%s every %ss",
             SYNC_ROLE, SYNC_UPSTREAM, SYNC_INTERVAL)
    while True:
        try:
            await sync_cycle()
            status["last_ok"] = dt.datetime.now(dt.timezone.utc).isoformat()
            status["last_error"] = None
            status["upstream_reachable"] = True
        except Exception as e:  # network down is a normal state, not a crash
            status["last_error"] = f"{type(e).__name__}: {e}"
            status["upstream_reachable"] = False
            log.warning("sync cycle failed: %s", e)
        _wake.clear()
        try:
            await asyncio.wait_for(_wake.wait(), timeout=SYNC_INTERVAL)
        except asyncio.TimeoutError:
            pass


# --------------------------------------------- encrypted buddy snapshots

def _blob_cipher():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import hashlib

    return AESGCM(hashlib.sha256(BUDDY_BLOB_KEY.encode()).digest())


async def build_snapshot() -> bytes:
    """Full dataset (tasks DB export + every notes file) as one gzip blob."""
    import gzip

    async with db.pool().acquire() as conn:
        data = await export_changes(conn, None)
    snap = {"format": "streak.snapshot", "version": 1, "tasks": data, "notes": []}
    if NOTES_INTERNAL_URL:
        async with _client() as http:
            base = f"{NOTES_INTERNAL_URL}/api/notes/sync"
            r = await http.get(f"{base}/manifest")
            r.raise_for_status()
            for f in r.json()["files"]:
                fr = await http.get(f"{base}/file", params={"path": f["path"]})
                fr.raise_for_status()
                snap["notes"].append({
                    "path": f["path"], "mtime": f["mtime"],
                    "data": base64.b64encode(fr.content).decode(),
                })
    return gzip.compress(json.dumps(snap).encode())


def encrypt_blob(plain: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + _blob_cipher().encrypt(nonce, plain, b"streak.blob.v1")


def decrypt_blob(blob: bytes) -> bytes:
    return _blob_cipher().decrypt(blob[:12], blob[12:], b"streak.blob.v1")


async def blob_job():
    """Host role: periodically push an encrypted snapshot to the buddy.

    The buddy stores ciphertext only — without BUDDY_BLOB_KEY the blob is
    opaque to them. Recovery: scripts/restore_blob.py against a fresh stack.
    """
    import httpx

    log.info("blob job: pushing encrypted snapshots to %s every %ss",
             BUDDY_BLOB_URL, BLOB_INTERVAL)
    while True:
        try:
            blob = encrypt_blob(await build_snapshot())
            name = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
            async with httpx.AsyncClient(
                headers={"X-Sync-Token": BUDDY_BLOB_TOKEN or SYNC_TOKEN}, timeout=300
            ) as http:
                r = await http.post(
                    f"{BUDDY_BLOB_URL}/api/sync/peer/blob",
                    content=blob,
                    headers={"X-Blob-Name": name,
                             "Content-Type": "application/octet-stream"},
                )
                r.raise_for_status()
            status["last_blob"] = dt.datetime.now(dt.timezone.utc).isoformat()
        except Exception as e:
            status["last_blob_error"] = f"{type(e).__name__}: {e}"
            log.warning("blob push failed: %s", e)
        await asyncio.sleep(BLOB_INTERVAL)


def start_background_tasks() -> list[asyncio.Task]:
    """Called from the app lifespan; returns tasks to cancel on shutdown."""
    tasks = []
    if SYNC_ROLE in ("backup", "mirror") and SYNC_UPSTREAM and SYNC_TOKEN:
        tasks.append(asyncio.create_task(engine_loop()))
    if SYNC_ROLE == "host" and BUDDY_BLOB_URL and BUDDY_BLOB_KEY:
        tasks.append(asyncio.create_task(blob_job()))
    return tasks
