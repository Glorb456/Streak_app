"""Sync endpoints.

Two audiences, two auth models, split by path on purpose:

- /sync/peer/*  — machine-to-machine. oauth2-proxy is configured to skip these
  (a syncing node has no Google cookie), so they enforce the pre-shared
  X-Sync-Token themselves and are disabled outright when SYNC_TOKEN is unset.
  This is also what lets a buddy's mirror sync from this host without being
  on this host's Google allowlist — the token authorises the *machine*, while
  logging in to the app itself still requires the owner's Google account.

- /sync/status, /sync/now, /sync/conflicts — human endpoints for the web UI
  and the companion app. These stay behind oauth2-proxy like every other
  /api route and need no token.
"""
import json
import os
import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request

from .. import db, sync

router = APIRouter(tags=["sync"])

BLOB_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def require_token(x_sync_token: str | None):
    if not sync.SYNC_TOKEN:
        raise HTTPException(403, "sync is not enabled on this node")
    if not secrets.compare_digest(x_sync_token or "", sync.SYNC_TOKEN):
        raise HTTPException(401, "bad sync token")


# ------------------------------------------------------------ peer (token)

@router.get("/sync/peer/export")
async def peer_export(since: str = "", x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    async with db.pool().acquire() as conn:
        return await sync.export_changes(conn, sync._ts(since) if since else None)


@router.post("/sync/peer/import")
async def peer_import(request: Request, x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    payload = await request.json()
    async with db.pool().acquire() as conn:
        return await sync.import_changes(
            conn, payload, peer=request.client.host if request.client else ""
        )


@router.post("/sync/peer/blob")
async def peer_blob_store(request: Request,
                          x_sync_token: str | None = Header(None),
                          x_blob_name: str = Header("blob")):
    """Store a buddy's encrypted snapshot. Ciphertext in, ciphertext on disk —
    this node never holds the key, so hosting a buddy's backup reveals
    nothing. Old blobs are pruned to the newest BLOB_KEEP."""
    require_token(x_sync_token)
    if not BLOB_NAME_RE.match(x_blob_name):
        raise HTTPException(400, "bad blob name")
    data = await request.body()
    if not data or len(data) > 512 * 1024 * 1024:
        raise HTTPException(413, "blob empty or too large")
    d = Path(sync.BLOB_DIR)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{x_blob_name}.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, d / f"{x_blob_name}.blob")
    blobs = sorted(d.glob("*.blob"))
    for old in blobs[:-sync.BLOB_KEEP]:
        old.unlink()
    return {"ok": True, "stored": f"{x_blob_name}.blob", "kept": min(len(blobs), sync.BLOB_KEEP)}


@router.get("/sync/peer/blobs")
async def peer_blob_list(x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    d = Path(sync.BLOB_DIR)
    return {
        "blobs": sorted(p.name for p in d.glob("*.blob")) if d.is_dir() else []
    }


@router.get("/sync/peer/blob/{name}")
async def peer_blob_get(name: str, x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    from fastapi.responses import FileResponse

    d = Path(sync.BLOB_DIR)
    if name == "latest":
        blobs = sorted(d.glob("*.blob")) if d.is_dir() else []
        if not blobs:
            raise HTTPException(404, "no blobs stored")
        path = blobs[-1]
    else:
        if not BLOB_NAME_RE.match(name):
            raise HTTPException(404, "not found")
        path = d / name
        if not path.is_file():
            raise HTTPException(404, "not found")
    return FileResponse(path, media_type="application/octet-stream")


# ------------------------------------------------- human (behind oauth2-proxy)

@router.get("/sync/status")
async def sync_status():
    async with db.pool().acquire() as conn:
        unresolved = await conn.fetchval(
            "SELECT count(*) FROM sync_conflicts WHERE NOT resolved"
        )
        peers = await conn.fetch("SELECT * FROM sync_peers")
    return {
        **sync.status,
        "conflicts": unresolved,
        "peers": [{k: sync._enc(v) for k, v in p.items()} for p in peers],
    }


@router.post("/sync/now")
async def sync_now():
    sync.request_sync_now()
    return {"ok": True}


@router.get("/sync/conflicts")
async def list_conflicts():
    async with db.pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, tbl, uid, kept, lost, peer, created_at "
            "FROM sync_conflicts WHERE NOT resolved ORDER BY created_at DESC"
        )
    return [
        {
            "id": r["id"], "tbl": r["tbl"], "uid": r["uid"], "peer": r["peer"],
            "created_at": sync._enc(r["created_at"]),
            "kept": json.loads(r["kept"]), "lost": json.loads(r["lost"]),
        }
        for r in rows
    ]


@router.post("/sync/conflicts/{conflict_id}/resolve")
async def resolve_conflict(conflict_id: int, body: dict):
    """{"restore": true} puts the losing version back; false keeps what won.
    Either way the conflict is settled and leaves the list."""
    async with db.pool().acquire() as conn:
        if body.get("restore"):
            ok = await sync.restore_conflict(conn, conflict_id)
            if not ok:
                raise HTTPException(404, "conflict not found")
        else:
            await conn.execute(
                "UPDATE sync_conflicts SET resolved = TRUE WHERE id = $1", conflict_id
            )
    return {"ok": True}
