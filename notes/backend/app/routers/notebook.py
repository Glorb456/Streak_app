from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import store
from ..schemas import (
    Page, PageCreate, PageUpdate, Reorder, Section, SectionCreate, SectionUpdate,
)

router = APIRouter(prefix="/api/notes", tags=["notebook"])


def _run(fn, *args):
    """Translate the store's StoreError into the matching HTTP response.

    Keeps every filesystem rule (traversal, name collisions, size limits) in
    store.py and out of the routes. A conflict carries the page as it now
    stands, so the client can merge and retry in one round trip.
    """
    try:
        return fn(*args)
    except store.StoreError as e:
        if e.payload is not None:
            raise HTTPException(e.status, {"message": e.detail, "current": e.payload})
        raise HTTPException(e.status, e.detail)


@router.get("/tree", response_model=list[Section])
async def get_tree():
    return _run(store.tree)


@router.post("/sections")
async def create_section(body: SectionCreate):
    return _run(store.create_section, body.name)


# Declared before /sections/{section_id}: routes match in definition order, so
# the other order would capture "order" as a section id and 404 on it.
@router.put("/sections/order")
async def reorder_sections(body: Reorder):
    _run(store.reorder_sections, body.ids)
    return {"ok": True}


@router.put("/sections/{section_id}")
async def update_section(section_id: str, body: SectionUpdate):
    return _run(store.update_section, section_id, body.name, body.color)


@router.delete("/sections/{section_id}")
async def delete_section(section_id: str):
    _run(store.delete_section, section_id)
    return {"ok": True}


@router.put("/sections/{section_id}/pages/order")
async def reorder_pages(section_id: str, body: Reorder):
    _run(store.reorder_pages, section_id, body.ids)
    return {"ok": True}


# ------------------------------------------------------------------ assets
# Declared before /pages/{page_id} for the same reason as /sections/order.

@router.post("/assets")
async def upload_asset(file: UploadFile = File(...)):
    """Take an image off the device and store it in the notebook.

    On iOS this is the back half of an <input type="file" accept="image/*">,
    so what arrives is whatever the photo picker handed over — including HEIC.
    The bytes decide what it is; the filename is not consulted at all.
    """
    data = await file.read()
    return _run(store.save_asset, data)


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str):
    path, mime = _run(store.asset_path, asset_id)
    # Content-addressed, so a given id can never point at different bytes —
    # which is exactly the case immutable caching is for. Saves re-fetching
    # every image on a drawing page each time it is opened.
    return FileResponse(
        path,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ------------------------------------------------------------------- pages

@router.post("/pages", response_model=Page)
async def create_page(body: PageCreate):
    return _run(store.create_page, body.section_id, body.title, body.kind)


@router.get("/pages/{page_id}", response_model=Page)
async def get_page(page_id: str):
    return _run(store.read_page, page_id)


@router.put("/pages/{page_id}", response_model=Page)
async def update_page(page_id: str, body: PageUpdate):
    """Save a page, optionally guarded by the etag it was read at.

    A 409 answers with the page as it now stands under detail.current, so a
    client whose save lost the race can merge and retry immediately. Only the
    drawing client sends if_match; a markdown page is one editor's own text and
    stays last-write-wins.
    """
    return _run(store.update_page, page_id, body.title, body.content, body.if_match)


@router.delete("/pages/{page_id}")
async def delete_page(page_id: str):
    _run(store.delete_page, page_id)
    return {"ok": True}
