"""File-level sync for the Streak Notes notebook.

The notebook is a directory of real files (see notes/backend/app/store.py),
so notes sync is rsync-shaped rather than row-shaped: compare the two sides'
manifests (path, mtime, sha256), copy whichever side is newer, and honour
tombstones so a deleted page stays deleted. Writes go through the notes
backends' /api/notes/sync endpoints on both sides, which preserve mtimes —
that is what makes "newer" comparable across machines at all.

Conflicts (both sides changed the same page since the last completed sync)
never lose data: the losing version is saved next to the winner as
"<name> (conflict <stamp>)<ext>" before the newer one is copied over, and the
copy then propagates like any other new page. Assets are content-addressed so
they only ever gain files; the ordering sidecar (.streaknotes.json) is
presentation state only and stays silent last-writer-wins.
"""
import datetime as dt
import logging

log = logging.getLogger("streak.notesync")

# Both sides changed since the last sync => conflict copy. The marker is kept
# in memory per process: after a restart one extra conflict copy in the rare
# concurrently-edited case is a far better failure than data loss.
_last_sync: dict[str, float] = {}

META = ".streaknotes.json"
CONFLICT_EXTS = (".md", ".draw.json")


def _conflict_name(path: str) -> str:
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H%M%S")
    for ext in CONFLICT_EXTS:
        if path.endswith(ext):
            return f"{path[:-len(ext)]} (conflict {stamp}){ext}"
    return f"{path} (conflict {stamp})"


async def _manifest(http, base):
    r = await http.get(f"{base}/manifest")
    r.raise_for_status()
    return r.json()


async def _copy(http, src_base, dst_base, path, mtime):
    r = await http.get(f"{src_base}/file", params={"path": path})
    r.raise_for_status()
    w = await http.put(
        f"{dst_base}/file",
        params={"path": path, "mtime": str(mtime)},
        content=r.content,
        headers={"Content-Type": "application/octet-stream"},
    )
    w.raise_for_status()


async def _delete(http, base, path, ts):
    r = await http.delete(f"{base}/file", params={"path": path, "ts": str(ts)})
    if r.status_code not in (200, 404):
        r.raise_for_status()


async def sync_notes(http, local: str, remote: str) -> None:
    lman, rman = await _manifest(http, local), await _manifest(http, remote)
    lfiles = {f["path"]: f for f in lman["files"]}
    rfiles = {f["path"]: f for f in rman["files"]}
    ltomb, rtomb = lman.get("tombstones", {}), rman.get("tombstones", {})
    last = _last_sync.get(remote, 0.0)

    for path in sorted(set(lfiles) | set(rfiles)):
        lf, rf = lfiles.get(path), rfiles.get(path)

        if lf and not rf:
            ts = rtomb.get(path)
            if ts is not None and ts >= lf["mtime"]:
                await _delete(http, local, path, ts)  # their delete is newer
            else:
                await _copy(http, local, remote, path, lf["mtime"])
            continue

        if rf and not lf:
            ts = ltomb.get(path)
            if ts is not None and ts >= rf["mtime"]:
                await _delete(http, remote, path, ts)
            else:
                await _copy(http, remote, local, path, rf["mtime"])
            continue

        if lf["sha"] == rf["sha"]:
            continue

        # Same page, different bytes. Newer side wins; if both sides moved
        # since the last completed sync, park the loser as a conflict copy
        # first (pages only — the meta sidecar is not worth a conflict file,
        # and assets can't collide because their name is their hash).
        both = lf["mtime"] > last and rf["mtime"] > last
        conflictable = path.endswith(CONFLICT_EXTS) and not path.startswith(".")
        if rf["mtime"] >= lf["mtime"]:
            if both and conflictable:
                r = await http.get(f"{local}/file", params={"path": path})
                r.raise_for_status()
                w = await http.put(
                    f"{local}/file",
                    params={"path": _conflict_name(path), "mtime": str(lf["mtime"])},
                    content=r.content,
                    headers={"Content-Type": "application/octet-stream"},
                )
                w.raise_for_status()
            await _copy(http, remote, local, path, rf["mtime"])
        else:
            if both and conflictable:
                r = await http.get(f"{remote}/file", params={"path": path})
                r.raise_for_status()
                w = await http.put(
                    f"{local}/file",
                    params={"path": _conflict_name(path), "mtime": str(rf["mtime"])},
                    content=r.content,
                    headers={"Content-Type": "application/octet-stream"},
                )
                w.raise_for_status()
            await _copy(http, local, remote, path, lf["mtime"])

    # Deletions where the file is already gone on both sides need no copying,
    # only tombstone exchange — and that happens implicitly next cycle via the
    # manifests, so nothing further to do here.
    _last_sync[remote] = max(
        dt.datetime.now().timestamp(),
        *(f["mtime"] for f in lman["files"]),
        *(f["mtime"] for f in rman["files"]),
        0.0,
    )
