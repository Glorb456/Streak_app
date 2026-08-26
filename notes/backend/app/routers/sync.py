"""Machine-to-machine file sync for the notebook.

The sync engine (in the task backend of a backup/mirror node) treats the
notebook as what it is — a directory of files — and these endpoints are the
smallest possible remote-filesystem surface for it: list (manifest with
hashes and tombstones), read, write-preserving-mtime, delete-with-tombstone.

Auth is the pre-shared X-Sync-Token, enforced here because oauth2-proxy is
configured to skip /api/notes/sync (a syncing machine holds no Google
cookie). With SYNC_TOKEN unset the whole surface answers 403, so a plain
single-node install exposes nothing new.

Preserving mtimes on write is not cosmetic: "which side is newer" is decided
by comparing mtimes across machines, so a copy must carry the original file's
timestamp rather than the moment it landed.
"""
import hashlib
import os
import secrets
from pathlib import PurePosixPath

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse

from .. import store

router = APIRouter(prefix="/api/notes/sync", tags=["notes-sync"])

MAX_SYNC_BYTES = 16 * 1024 * 1024


def require_token(x_sync_token: str | None):
    token = os.environ.get("SYNC_TOKEN", "")
    if not token:
        raise HTTPException(403, "sync is not enabled on this node")
    if not secrets.compare_digest(x_sync_token or "", token):
        raise HTTPException(401, "bad sync token")


def resolve(path: str):
    """A notebook-relative path from the wire, or 400. Same traversal rules as
    store.decode_id, applied to the plain path the manifest speaks in."""
    rel = PurePosixPath(path)
    if rel.is_absolute() or not rel.parts or any(p in ("..", ".") for p in rel.parts):
        raise HTTPException(400, "bad path")
    if any(p.startswith(".") for p in rel.parts):
        # Dot-paths are store internals. Exactly two may travel: the ordering
        # sidecar and the content-addressed image store.
        if not (path == store.META_NAME or rel.parts[0] == store.ASSETS_NAME):
            raise HTTPException(400, "bad path")
    p = store.ROOT.joinpath(*rel.parts)
    if p.exists() and not p.resolve().is_relative_to(store.ROOT.resolve()):
        raise HTTPException(400, "bad path")
    return p


def _sha(path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:32]


@router.get("/manifest")
async def manifest(x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    store.ROOT.mkdir(parents=True, exist_ok=True)
    files = []
    for p in sorted(store.ROOT.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(store.ROOT).as_posix()
        parts = PurePosixPath(rel).parts
        hidden = any(part.startswith(".") for part in parts)
        if hidden and not (rel == store.META_NAME or parts[0] == store.ASSETS_NAME):
            continue  # tombstone file, tmp files, unknown dot-things
        if p.name.endswith(".tmp"):
            continue
        st = p.stat()
        files.append({"path": rel, "mtime": st.st_mtime, "size": st.st_size,
                      "sha": _sha(p)})
    return {
        "files": files,
        "tombstones": store.read_tombstones(),
    }


@router.get("/file")
async def get_file(path: str, x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    p = resolve(path)
    if not p.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="application/octet-stream",
                        headers={"X-Mtime": str(p.stat().st_mtime)})


@router.put("/file")
async def put_file(path: str, mtime: float, request: Request,
                   x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    p = resolve(path)
    data = await request.body()
    if len(data) > MAX_SYNC_BYTES:
        raise HTTPException(413, "file too large")
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, p)
    os.utime(p, (mtime, mtime))
    # An incoming write supersedes any old tombstone for the path (the page
    # was deleted once and later recreated elsewhere).
    store.clear_tombstone(path)
    return {"ok": True}


@router.delete("/file")
async def delete_file(path: str, ts: float, x_sync_token: str | None = Header(None)):
    require_token(x_sync_token)
    p = resolve(path)
    if p.is_file():
        p.unlink()
    # Recorded at the *originating* delete's timestamp, so the tombstone stays
    # stable as it propagates instead of racing every copy of itself.
    store.record_tombstones([path], ts)
    return {"ok": True}
