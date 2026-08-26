"""Filesystem-backed notebook store.

The notebook is a plain directory tree, and the tree is the source of truth:

    <root>/<Section>/<Page>.md          markdown page
    <root>/<Section>/<Page>.draw.json   hand-drawn page (vector strokes + images)
    <root>/.assets/<sha256>.<ext>       images placed on hand-drawn pages
    <root>/.streaknotes.json            ordering + section colours, nothing else

Every page a user writes is a real .md file they can open in another editor,
grep, sync or back up. The sidecar JSON carries presentation state only, so
deleting it costs the ordering and the section colours and nothing more, and a
section or page created outside the app still appears — it just lands at the
end of its list until it's dragged somewhere.
"""
import base64
import binascii
import hashlib
import json
import os
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

ROOT = Path(os.environ.get("NOTEBOOK_DIR", "/notebook"))
META_NAME = ".streaknotes.json"

MD_EXT = ".md"
DRAW_EXT = ".draw.json"
ASSETS_NAME = ".assets"

# The one section the app owns rather than the user. It is created on demand,
# cannot be deleted or renamed, and holds only sticky notes — the Streak task
# app writes here from its floating sticky-note widget, and it would have
# nowhere to put them if this section could disappear out from under it.
# Sticky notes are ordinary markdown, so they open and edit normally in Streak
# Notes too; what is fixed is the section, not the format.
STICKY_SECTION = "Sticky Notes"
STICKY_COLOR = "#f5c518"
# Longest suffix first: "x.draw.json" also ends with ".json", and matching the
# short one first would file every drawing under the wrong kind.
KINDS = ((DRAW_EXT, "drawing"), (MD_EXT, "markdown"))

MAX_NAME = 120
# A page is a hand-written note, not a disk image; refusing the absurd case
# keeps one bad client from filling the notebook volume. Drawings pack their
# samples (see the frontend codec), so this is a very long day of drawing.
MAX_BYTES = 5 * 1024 * 1024
MAX_ASSET_BYTES = 12 * 1024 * 1024

# A new drawing is written self-describing rather than as "{}", so the file
# says what it is even before a single stroke lands on it.
EMPTY_DRAWING = (
    '{"format":"streaknotes.draw","version":1,'
    '"page":{"w":1240,"h":1754},"rev":0,"elements":[],"deleted":{}}'
)

# Images are identified by sniffing the bytes, never by the name the client
# sent: the upload endpoint must not become a way to drop an arbitrary file
# into the notebook and then fetch it back with a content type of its choosing.
IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
)
ASSET_ID_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|gif|webp|heic)$")

# Section accent colours, handed out in order to newly created sections and
# reused from the top once they run out.
PALETTE = ["#d0409a", "#e0a52e", "#e0553e", "#3ba9e0", "#7b5cd6", "#3fb56b"]


class StoreError(Exception):
    """Raised with an HTTP status the router hands straight to the client."""

    def __init__(self, status: int, detail: str, payload: dict | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        # A conflict rides back with the page as it now stands, so the client
        # can merge and retry in one round trip instead of two.
        self.payload = payload


@dataclass
class Page:
    id: str
    title: str
    kind: str
    filename: str


# ---------------------------------------------------------------- ids

def encode_id(rel: PurePosixPath | str) -> str:
    """Opaque, URL-safe id for a path relative to the notebook root.

    Titles legitimately contain spaces, '#', '?' and non-ASCII, so the relative
    path is base64url'd rather than percent-encoded — that way an id survives
    being a path segment, a query value or a React key untouched.
    """
    return base64.urlsafe_b64encode(str(rel).encode()).decode().rstrip("=")


def decode_id(ident: str) -> Path:
    """Resolve an id back to an absolute path, or raise 404.

    Everything reachable from the API goes through here, so this is the single
    place a traversal attempt has to be stopped. Ids are opaque to clients and
    a malformed one is indistinguishable from a stale one, so both answer 404.
    """
    try:
        raw = base64.urlsafe_b64decode(ident + "=" * (-len(ident) % 4)).decode()
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise StoreError(404, "not found")
    rel = PurePosixPath(raw)
    if rel.is_absolute() or not rel.parts or any(p in ("..", ".") for p in rel.parts):
        raise StoreError(404, "not found")
    path = ROOT.joinpath(*rel.parts)
    # resolve() follows symlinks, so this also rejects a link inside the
    # notebook that points anywhere outside it.
    if not path.resolve().is_relative_to(ROOT.resolve()):
        raise StoreError(404, "not found")
    return path


# ------------------------------------------------------------- naming

_BAD_CHARS = re.compile(r'[/\\:*?"<>|\x00-\x1f]')


def safe_name(name: str) -> str:
    """Turn user text into a single, portable filename component.

    Rejects rather than silently mangles when nothing usable is left, so a
    rename to '///' surfaces as an error instead of creating 'Untitled'.
    """
    name = unicodedata.normalize("NFC", name).replace("\n", " ")
    name = _BAD_CHARS.sub("", name).strip()
    # A leading dot would hide the file from the listing below, and '.'/'..'
    # would escape it entirely.
    name = name.lstrip(".").strip()
    if not name:
        raise StoreError(400, "name is empty")
    return name[:MAX_NAME].strip()


def _unique(parent: Path, stem: str, ext: str) -> Path:
    """First free '<stem>.ext', '<stem> 2.ext', '<stem> 3.ext' … in parent."""
    candidate = parent / f"{stem}{ext}"
    n = 2
    while candidate.exists():
        candidate = parent / f"{stem} {n}{ext}"
        n += 1
    return candidate


def kind_of(filename: str) -> str | None:
    for ext, kind in KINDS:
        if filename.endswith(ext) and len(filename) > len(ext):
            return kind
    return None


def ext_for(kind: str) -> str:
    for ext, k in KINDS:
        if k == kind:
            return ext
    raise StoreError(400, f"unknown page kind {kind!r}")


def title_of(filename: str) -> str:
    for ext, _ in KINDS:
        if filename.endswith(ext):
            return filename[: -len(ext)]
    return filename


# -------------------------------------------------------------- meta

def _read_meta() -> dict:
    try:
        data = json.loads((ROOT / META_NAME).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"order": [], "sections": {}}
    if not isinstance(data, dict):
        return {"order": [], "sections": {}}
    data.setdefault("order", [])
    data.setdefault("sections", {})
    return data


def _write_meta(meta: dict) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = ROOT / f"{META_NAME}.tmp"
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    # Atomic: a crash mid-write leaves the previous ordering intact rather
    # than a truncated file that reads as "no ordering at all".
    os.replace(tmp, ROOT / META_NAME)


def _section_meta(meta: dict, name: str) -> dict:
    return meta["sections"].setdefault(name, {})


def _ordered(names: list[str], order: list) -> list[str]:
    """Apply a stored order to what is actually on disk.

    Names the order doesn't mention sort to the end alphabetically, which is
    where a section or page created outside the app shows up.
    """
    pos = {n: i for i, n in enumerate(order) if isinstance(n, str)}
    return sorted(names, key=lambda n: (pos.get(n, len(pos)), n.lower()))


# ----------------------------------------------------------- snippets

_FENCE = re.compile(r"^\s*(```|~~~)")
_STRIP = re.compile(r"(\*\*|__|[*_`~#>]|^\s*[-+]\s+\[[ xX]\]\s*|^\s*[-+*]\s+)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")

SNIPPET_LEN = 90


def snippet_of(text: str) -> str:
    """One flat line of prose for the sidebar preview.

    Markdown punctuation is stripped rather than rendered: the preview is two
    lines of grey text in a narrow column, where a stray '##' reads as noise.
    """
    out: list[str] = []
    in_fence = False
    for line in text.splitlines():
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        line = _LINK.sub(r"\1", line)
        line = _STRIP.sub("", line).strip()
        if line and not set(line) <= {"-", "=", " "}:
            out.append(line)
        if sum(len(o) for o in out) > SNIPPET_LEN:
            break
    joined = " ".join(out).strip()
    return joined[:SNIPPET_LEN].strip()


# -------------------------------------------------------------- read

def _page_files(section: Path) -> list[str]:
    return [
        p.name
        for p in section.iterdir()
        if p.is_file() and not p.name.startswith(".") and kind_of(p.name)
    ]


def _page_entry(section_rel: str, filename: str, path: Path) -> dict:
    kind = kind_of(filename)
    snippet = ""
    if kind == "markdown":
        try:
            snippet = snippet_of(path.read_text(errors="replace"))
        except OSError:
            snippet = ""
    return {
        "id": encode_id(f"{section_rel}/{filename}"),
        "title": title_of(filename),
        "kind": kind,
        "snippet": snippet,
        "updated_at": path.stat().st_mtime,
    }


def ensure_sticky_section() -> Path:
    """Create the sticky-notes section if it is missing, and return it.

    Called from tree(), which is the one read path both apps go through, so the
    section reappears the moment anything looks at the notebook — including
    after someone deletes the directory by hand.
    """
    path = ROOT / STICKY_SECTION
    if not path.is_dir():
        path.mkdir(parents=True, exist_ok=True)
        meta = _read_meta()
        if STICKY_SECTION not in meta["order"]:
            # First, not last: it is the section the widget writes to, so it
            # belongs at the top of the sidebar rather than after whatever the
            # user has been working on.
            meta["order"] = [STICKY_SECTION] + [n for n in meta["order"] if n != STICKY_SECTION]
        _section_meta(meta, STICKY_SECTION).setdefault("color", STICKY_COLOR)
        _write_meta(meta)
    return path


def tree() -> list[dict]:
    """Every section and page in the notebook, in display order."""
    ROOT.mkdir(parents=True, exist_ok=True)
    ensure_sticky_section()
    meta = _read_meta()
    # Dot-directories are skipped, which is also what keeps .assets/ — the
    # image store — from showing up in the sidebar as a section.
    dirs = [
        p.name
        for p in ROOT.iterdir()
        if p.is_dir() and not p.name.startswith(".")
    ]
    sections = []
    for i, name in enumerate(_ordered(dirs, meta["order"])):
        smeta = meta["sections"].get(name, {})
        path = ROOT / name
        files = _ordered(_page_files(path), smeta.get("pages", []))
        sections.append({
            "id": encode_id(name),
            "name": name,
            "color": smeta.get("color") or PALETTE[i % len(PALETTE)],
            # Flagged rather than left for each client to match on the name:
            # two frontends read this tree, and both need the same answer about
            # what they may offer to do to it.
            "sticky": name == STICKY_SECTION,
            "pages": [_page_entry(name, f, path / f) for f in files],
        })
    return sections


def etag_of(path: Path) -> str:
    """Version tag for a page: a hash of its bytes.

    Content rather than mtime, because two devices saving inside the same
    filesystem timestamp tick is exactly the race this guards, and because a
    save that changes nothing should not look like a conflict to the other
    device.
    """
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:32]


def read_page(ident: str) -> dict:
    path = decode_id(ident)
    if not path.is_file() or not kind_of(path.name):
        raise StoreError(404, "page not found")
    return {
        "id": ident,
        "title": title_of(path.name),
        "kind": kind_of(path.name),
        "section_id": encode_id(path.parent.name),
        "content": path.read_text(errors="replace"),
        "etag": etag_of(path),
    }


# ------------------------------------------------------------- write

def create_section(name: str) -> dict:
    ROOT.mkdir(parents=True, exist_ok=True)
    path = _unique(ROOT, safe_name(name), "")
    path.mkdir()
    meta = _read_meta()
    # Appended, not prepended: a new section belongs at the bottom of the list
    # where the '+ Section' button that made it sits.
    meta["order"] = [n for n in meta["order"] if n != path.name] + [path.name]
    _section_meta(meta, path.name)["color"] = PALETTE[
        (len(meta["order"]) - 1) % len(PALETTE)
    ]
    _write_meta(meta)
    return {"id": encode_id(path.name), "name": path.name}


def update_section(ident: str, name: str | None, color: str | None) -> dict:
    path = decode_id(ident)
    if not path.is_dir():
        raise StoreError(404, "section not found")
    meta = _read_meta()
    old = path.name
    if name is not None and safe_name(name) != old:
        # Renaming it away would leave the app to auto-create a second one and
        # strand every sticky note in the orphan, which is the same loss as a
        # delete. The colour stays editable.
        if old == STICKY_SECTION:
            raise StoreError(403, f"“{STICKY_SECTION}” cannot be renamed")
        target = ROOT / safe_name(name)
        if target.exists():
            raise StoreError(409, "a section with that name already exists")
        path.rename(target)
        # Carry the colour and page order across, or the rename would read as
        # a delete-and-recreate in the sidebar.
        meta["sections"][target.name] = meta["sections"].pop(old, {})
        meta["order"] = [target.name if n == old else n for n in meta["order"]]
        path = target
    if color is not None:
        _section_meta(meta, path.name)["color"] = color
    _write_meta(meta)
    return {"id": encode_id(path.name), "name": path.name}


def delete_section(ident: str) -> None:
    path = decode_id(ident)
    if not path.is_dir():
        raise StoreError(404, "section not found")
    # The notes inside it are deletable; the section itself is not.
    if path.name == STICKY_SECTION:
        raise StoreError(403, f"“{STICKY_SECTION}” cannot be deleted")
    for child in sorted(path.rglob("*"), reverse=True):
        child.rmdir() if child.is_dir() else child.unlink()
    path.rmdir()
    meta = _read_meta()
    meta["order"] = [n for n in meta["order"] if n != path.name]
    meta["sections"].pop(path.name, None)
    _write_meta(meta)


def reorder_sections(ids: list[str]) -> None:
    names = [decode_id(i).name for i in ids]
    meta = _read_meta()
    _write_meta({**meta, "order": names})


def create_page(section_id: str, title: str, kind: str) -> dict:
    section = decode_id(section_id)
    if not section.is_dir():
        raise StoreError(404, "section not found")
    # A sticky note is markdown — the same '- [ ]' checklist encoding the task
    # app already uses — so a drawing here would be a page the sticky widget
    # could not open. Enforced on the API rather than in the two frontends,
    # which is also what keeps a hand-rolled request from getting round it.
    if section.name == STICKY_SECTION and kind != "markdown":
        raise StoreError(400, f"only sticky notes belong in “{STICKY_SECTION}”")
    ext = ext_for(kind)
    path = _unique(section, safe_name(title), ext)
    # A markdown page starts as a blank document; a drawing starts as a valid,
    # empty vector document rather than a bare "{}".
    path.write_text("" if kind == "markdown" else EMPTY_DRAWING)
    meta = _read_meta()
    smeta = _section_meta(meta, section.name)
    smeta["pages"] = [p for p in smeta.get("pages", []) if p != path.name] + [path.name]
    _write_meta(meta)
    return read_page(encode_id(f"{section.name}/{path.name}"))


def update_page(
    ident: str,
    title: str | None,
    content: str | None,
    if_match: str | None = None,
) -> dict:
    path = decode_id(ident)
    if not path.is_file() or not kind_of(path.name):
        raise StoreError(404, "page not found")
    # Optimistic concurrency. Without this a drawing open on the iPad and the
    # desktop is last-write-wins, and whichever device saved first silently
    # loses every stroke it made. The client merges the returned page against
    # its own copy and retries.
    if if_match is not None and if_match != etag_of(path):
        raise StoreError(409, "page changed on another device", read_page(ident))
    if content is not None:
        if len(content.encode()) > MAX_BYTES:
            raise StoreError(413, "page is too large")
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_text(content)
        os.replace(tmp, path)
    if title is not None:
        ext = ext_for(kind_of(path.name))
        new_name = f"{safe_name(title)}{ext}"
        if new_name != path.name:
            target = path.with_name(new_name)
            if target.exists():
                raise StoreError(409, "a page with that name already exists")
            path.rename(target)
            meta = _read_meta()
            smeta = _section_meta(meta, path.parent.name)
            smeta["pages"] = [
                new_name if p == path.name else p for p in smeta.get("pages", [])
            ]
            _write_meta(meta)
            path = target
    return read_page(encode_id(f"{path.parent.name}/{path.name}"))


def delete_page(ident: str) -> None:
    path = decode_id(ident)
    if not path.is_file() or not kind_of(path.name):
        raise StoreError(404, "page not found")
    path.unlink()
    meta = _read_meta()
    smeta = _section_meta(meta, path.parent.name)
    smeta["pages"] = [p for p in smeta.get("pages", []) if p != path.name]
    _write_meta(meta)


def reorder_pages(section_id: str, ids: list[str]) -> None:
    section = decode_id(section_id)
    if not section.is_dir():
        raise StoreError(404, "section not found")
    meta = _read_meta()
    _section_meta(meta, section.name)["pages"] = [decode_id(i).name for i in ids]
    _write_meta(meta)


# ------------------------------------------------------------- assets

def assets_dir() -> Path:
    d = ROOT / ASSETS_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def sniff_image(data: bytes) -> tuple[str, str]:
    """Identify an upload by its bytes. Returns (extension, content type).

    The client's filename and declared type are ignored entirely — trusting
    either would turn this endpoint into a way to store an arbitrary file in
    the notebook and serve it back under a content type of the uploader's
    choosing, which is how an image upload becomes a stored-XSS hole.
    """
    for magic, ext, mime in IMAGE_MAGIC:
        if data.startswith(magic):
            return ext, mime
    # RIFF containers and the ISO-BMFF family need a second look: their magic
    # sits past a length field rather than at byte zero.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"mif1"):
        # iOS hands these over from the photo library as-is when the picker
        # doesn't transcode; Safari renders them natively.
        return "heic", "image/heic"
    raise StoreError(400, "not a recognised image")


def save_asset(data: bytes) -> dict:
    """Store an image, addressed by the hash of its own bytes.

    Content-addressed rather than named, so the same photo dropped on three
    pages is stored once, a re-upload after an undo costs nothing, and there is
    no filename to collide over or sanitise.
    """
    if not data:
        raise StoreError(400, "empty upload")
    if len(data) > MAX_ASSET_BYTES:
        raise StoreError(413, "image is too large")
    ext, mime = sniff_image(data)
    digest = hashlib.sha256(data).hexdigest()[:32]
    asset_id = f"{digest}.{ext}"
    path = assets_dir() / asset_id
    if not path.exists():
        tmp = path.with_name(f".{asset_id}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return {"id": asset_id, "type": mime, "size": len(data)}


def asset_path(asset_id: str) -> tuple[Path, str]:
    """Resolve an asset id to a file and its content type.

    The id is matched against a strict pattern rather than decoded as a path:
    it is the one identifier a client can name directly, so it is never allowed
    to be anything but a hash and a known extension.
    """
    if not ASSET_ID_RE.match(asset_id or ""):
        raise StoreError(404, "asset not found")
    path = assets_dir() / asset_id
    if not path.is_file():
        raise StoreError(404, "asset not found")
    ext = asset_id.rsplit(".", 1)[1]
    mime = {
        "png": "image/png", "jpg": "image/jpeg", "gif": "image/gif",
        "webp": "image/webp", "heic": "image/heic",
    }[ext]
    return path, mime
