from pydantic import BaseModel, Field


class PageSummary(BaseModel):
    id: str
    title: str
    kind: str  # "markdown" | "drawing"
    # Flat prose preview for the sidebar; always "" for a drawing.
    snippet: str
    updated_at: float


class Section(BaseModel):
    id: str
    name: str
    color: str
    pages: list[PageSummary]


class Page(BaseModel):
    id: str
    title: str
    kind: str
    section_id: str
    content: str
    # Version tag of the bytes on disk; a drawing client sends it back as
    # if_match so a save that lost a race is refused instead of clobbering.
    etag: str


class SectionCreate(BaseModel):
    name: str = "New section"


class SectionUpdate(BaseModel):
    """Both fields optional: the colour swatch and the rename are separate
    edits, and sending only one must not blank the other."""

    name: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")


class PageCreate(BaseModel):
    section_id: str
    title: str = "Untitled Page"
    kind: str = "markdown"


class PageUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    # Omitted means "overwrite whatever is there" — which is right for a
    # markdown page with one editor, and wrong for a drawing open on two
    # devices, so the drawing client always sends it.
    if_match: str | None = None


class Reorder(BaseModel):
    """One list's ids in the order they should appear.

    Whole-list rather than per-item, for the same reason the task calendar
    reorders a whole day: the server rewrites the order from this array in one
    write, so a reorder cannot half-apply.
    """

    ids: list[str]
