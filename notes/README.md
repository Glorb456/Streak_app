# Streak Notes

A OneNote-shaped notebook that lives beside the task app. It runs in the same
browser window and behind the same Google login, but shares nothing else with
it — its own API, its own storage, and no database at all.

```
notes/
  frontend/   React (Vite) SPA, served by nginx at /notes/
  backend/    FastAPI over a directory of files; no database
  notebook/   the notebook itself — one directory per section, one file per page
```

## Storage

Pages are ordinary files, and the tree on disk is the source of truth:

```
notebook/
  Physics E M/
    Maxwell.md            a markdown page
  Other/
    Skulk idea.draw.json  a hand-drawn page (packed vector strokes + images)
  Sticky Notes/
    Call the plumber.md   a sticky note from the Streak task app
  .assets/
    3f2a….png             images placed on drawings, addressed by content hash
  .streaknotes.json       section order, page order, section colours
```

So a page is a real `.md` file you can open in any editor, grep, sync or back
up, and the app is only one way to read it. The sidecar JSON holds presentation
state and nothing else: delete it and you lose the ordering and the accent
colours, not a word of content. A section or page created outside the app shows
up on the next load — it just lands at the end of its list.

`notebook/` is bind-mounted from the host and the container runs as uid 1000, so
the files stay editable without sudo. If the account running compose isn't
1000:1000, set `NOTES_UID` / `NOTES_GID` in `streak/.env`.

The notebook is personal content living inside the repo. It is deliberately
*not* in `.gitignore` — decide whether you want it committed as a backup or
ignored, and add `notes/notebook/` there if it's the latter.

## Auth

Both apps sit behind the one nginx (`frontend/nginx.conf`), which is what
oauth2-proxy fronts, so one cookie authorises both and switching apps is a plain
navigation with no second login:

```
/            the task app
/notes/      this app
/api/        the task API
/api/notes/  this API
```

`/api/notes/` sits under `/api` on purpose: oauth2-proxy's `--api-route=^/api`
then covers it too, so an expired session answers with a 401 the client can act
on rather than a Google login page it would try to parse as JSON.

## The Sticky Notes section

One section is the app's rather than the user's. The Streak task app has a
floating sticky-note pad that writes here, so this section behaves like
infrastructure:

- **It materialises on any read of the tree**, so it is always there and there
  is no "create it first" path for either frontend to get wrong. Delete the
  directory by hand and it comes back on the next load.
- **It cannot be deleted or renamed** (403). Renaming is refused for the same
  reason as deleting: the app would auto-create a fresh one and every existing
  sticky note would be stranded in the orphan. Its colour is still editable.
- **Only sticky notes go in it** — a drawing is refused (400), because the pad
  can only open markdown. `+ Page` here skips the kind chooser and just makes a
  note.
- **The notes inside it are ordinary pages** and can be deleted, edited and
  read here like any other markdown.

Sections carry a `sticky` flag in the tree, so both frontends key their
affordances off the server's answer rather than matching on the name.

A sticky note is plain markdown using the same `- [ ]` / `- [x]` checklist
encoding as Streak's task notes, so one note reads the same in the pad, in this
app, and in any other editor. Its filename is its first line, the way the old
Notes app titled things — the pad renames the file as that line changes, and
falls back to keeping the old name if another note already owns it (two notes
may start with the same line; two files may not share a name).

## Markdown pages

The editor is line-based and live, in the Notion/Outline shape: the line holding
the caret is its raw markdown in a textarea, every other line is rendered. The
document *is* the `.md` text, so there is no second model to keep in step with
the file.

Supported: `#`–`######`, `-`/`*`/`+` bullets, `1.` ordered lists, `- [ ]`/`- [x]`
tasks, `>` quotes, ` ``` ` fences, `---` rules, and inline `**bold**`,
`*italic*`, `` `code` ``, `~~strike~~`, `[text](url)`.

- Enter continues a list and counts an ordered one on; Enter on an empty item
  ends the list.
- Backspace at the head of an item's text strips the marker; at the very start
  of a line it merges into the line above.
- Tab / Shift-Tab indent and outdent a list item.
- Clicking a rendered line puts the caret under the pointer, not at the end —
  `md.js` maps rendered offsets back to source offsets so formatting doesn't
  throw the aim off.
- Typing is written to disk 700 ms after it stops, and flushed on page switch,
  rename and tab close.

Links with a scheme other than http/https/mailto render as inert text; a note
can arrive from anywhere, and `javascript:` is the one way it could execute
something when another device opens it.

## Hand-drawn pages

A vector canvas built for an Apple Pencil in Safari. Nothing is ever rasterised
into the file: the document is strokes in page units, and the view scales them,
so the same page is crisp on a 3x iPad and a 1x monitor.

### Input

- **The pencil draws, fingers scroll.** `pointerType === 'pen'` (and mouse)
  draws; `'touch'` can only pan. That split *is* the palm rejection — a resting
  palm arrives as a touch pointer and can never put ink down.
- **Every sample is kept.** `getCoalescedEvents()` returns the samples the
  digitiser took between frames; an Apple Pencil reports far faster than the
  display refreshes and dropping the rest visibly corners a fast curve.
- **`getPredictedEvents()`** is drawn on the live layer but never committed,
  which puts ink under the tip a frame or two early.
- **Pressure** comes from the pencil. A mouse has none, so width is derived
  from speed instead — a fast flick tapers the way a real pen does.

### Latency

Two canvases. The base layer holds every committed element and repaints only
when something structural changes (scroll, erase, move, undo); the stroke under
the pen repaints alone on the live layer each frame. A committed stroke is
blitted straight onto the base layer rather than triggering a full redraw, and
every repaint culls to the visible band by cached bounds, so a thousand-stroke
page costs a thousand box tests rather than a thousand path fills.

Strokes are filled outlines, not stroked paths: canvas `lineWidth` is per-path,
so a stroke-based approach can only step width between sub-paths and seams at
every step. `geometry.js` smooths the samples, resamples along a centripetal
Catmull-Rom spline by true arc length, and offsets the centreline by a
pressure-driven radius into one closed polygon with round caps.

### File format

`<Page>.draw.json` is a JSON envelope — readable and diffable — with the sample
stream inside each stroke packed, because that is where all the bytes are:

1. quantise x/y to 1/16 px and pressure to 1/255
2. delta against the previous sample
3. zigzag, so small negatives stay small
4. LEB128 varint — a typical delta is one byte
5. base64, to survive inside JSON

About 3 bytes per sample against ~30 for the naive encoding. Strokes are also
simplified once on commit, by an RDP that scores **position and pressure**
together: geometry-only RDP collapses a straight stroke to its two endpoints and
throws its taper away, and on a straight line the taper is the only thing there
was to keep.

### Tools

Five pencils, each with its own colour (the shared `ColorSwatch`, the same
native picker the section rail uses), width and opacity — slot 4 is a
highlighter. Tap a pencil to select it, tap it again for its settings. Pencils
live in `localStorage`, not the notebook: which colour is in slot 3 belongs to
the person holding the iPad, not to the page.

- **Lasso** — circle strokes to select them, then drag from inside the selection
  to move the group. Dragged elements are painted on the live layer while the
  base layer repaints without them, so only what moves is redrawn.
- **Object eraser** — removes whole strokes it crosses.
- **Pixel eraser** — resizable; splits a stroke into the fragments that survive,
  which is a real vector edit, not a mask. Fragments inherit the original's
  creation time so they keep its place in the page order. Both erasers test
  against the segment the eraser travelled, not the point under the cursor: at
  pen speed the pointer jumps tens of pixels between frames.

### Images

`<input type="file" accept="image/*">`, which is what makes iOS offer Photo
Library / Take Photo / Files. Uploads are **content-addressed** by the hash of
their own bytes, stored once under `notebook/.assets/`, and referenced from the
page — so the same photo on three pages costs one file and there is no filename
to collide over. The type is decided by sniffing the magic bytes; the filename
and declared content type are ignored entirely, or the endpoint would be a way
to park arbitrary bytes in the notebook and serve them back under a content type
of the uploader's choosing. PNG, JPEG, GIF, WebP and HEIC (what an iPhone
actually hands over) are accepted.

### Sync

Whole-file last-write-wins would silently discard whichever device saved first,
so drawings use optimistic concurrency:

- `GET /pages/{id}` returns an `etag` (a hash of the bytes)
- the drawing client sends it back as `if_match`
- a stale save is refused with **409**, carrying the current page under
  `detail.current`, so the client merges and retries in one round trip

`mergeDocs` is what makes that safe. Elements union by id; a tombstone on either
side wins, so an erase is never resurrected by the other device still holding
the stroke; an element both sides changed resolves to the later `mt`; order is
by `ct`, so both devices draw the page identically. It is commutative and
idempotent, which is what lets it run on whichever side notices the conflict, as
many times as the sync needs.

There is **no polling loop**. A drawing pushes on a 900 ms idle debounce and
pulls on tab focus, so a drawing left open in a background tab costs nothing.
The main Streak app's own 5 s poll is untouched by any of this — different app,
different container, no shared loop, and the drawing save deliberately skips the
sidebar tree refresh a markdown save does, since a drawing has no snippet to
update.

## Tests

```bash
# Backend: the store against a real (temporary) directory tree
cd streak/notes
docker compose -f docker-compose.test.yml up --build \
    --abort-on-container-exit --exit-code-from backend-tests

# Frontend: the markdown engine, the vector core (codec, geometry, doc, erase)
docker run --rm -v "$PWD/frontend":/app -v /app/node_modules \
    -w /app node:20-alpine sh -c "npm install && npm test"
```

## Dev without Docker

```bash
cd notes/backend && pip install -r requirements.txt
NOTEBOOK_DIR=../notebook uvicorn app.main:app --reload --port 8001

cd notes/frontend && npm install && npm run dev   # proxies /api/notes to :8001
```
