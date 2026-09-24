# Streak — edits (applied)

All edits from the test pass have been applied and are covered by tests.
Status: **35 passed** (backend) · **27 passed** (frontend), 0 xfail.

## Running the tests

```bash
# Backend (spins up a throwaway Postgres, no local python needed)
cd streak_app
docker compose -f docker-compose.test.yml up --build \
    --abort-on-container-exit --exit-code-from backend-tests

# Frontend (pure logic: dates + streak tint)
docker run --rm -v "$PWD/frontend":/app -v /app/node_modules \
    -w /app node:20-alpine sh -c "npm install && npm test"
```

---

## Bug fixes

1. **`PUT /categories/{id}` on a missing id → 404** (was 500 via `dict(None)`).
   `routers/categories.py` now null-checks and raises `HTTPException(404)`.
   Guarded by `test_categories.py::test_update_missing_returns_404`.

2. **`PUT /daily/{id}` on a missing id → 404** (was 500). Same fix in
   `routers/daily.py`. Guarded by `test_daily.py::test_update_missing_returns_404`.

3. **Completion for a non-existent daily task → 404** (was 500). `routers/daily.py`
   catches `asyncpg.ForeignKeyViolationError`. Guarded by
   `test_daily.py::test_completion_for_missing_daily_task_is_4xx`.

6. **Task create with a bad `category_id` → 400** (was 500). Same FK handling in
   `routers/tasks.py`. Guarded by `test_tasks.py::test_create_with_bad_category_is_4xx`.
   (Categories have no FK, so `POST /categories` needed no change.)

## Feature / hygiene edits

4. **A soft-deleted daily task can be reactivated.** `DailyTaskIn` gained
   `active: bool = True`; `daily_tasks_update.sql` now sets `active`; the
   update route passes it through. Guarded by
   `test_daily.py::test_soft_deleted_task_can_be_reactivated`.

5. **Completions of inactive daily tasks are no longer served.**
   `daily_completions_range.sql` joins `daily_tasks` and filters `d.active`.
   Guarded by `test_daily.py::test_completions_of_soft_deleted_task_are_excluded`.

7. **`/api/settings` no longer leaks the internal `seeded` flag.**
   `routers/settings.py` filters `INTERNAL_KEYS`. Guarded by
   `test_seed.py::test_seed_settings`.

8. **`dayTint` extracted to a pure, testable helper.** Moved from the closure in
   `components/Calendar.jsx` to `src/streaks.js` (Calendar now imports it).
   Covered by `src/streaks.test.js`: all-done→green, today-never-red, and the
   1/3 · 2/3 · >2/3 red thresholds.

---

## Test assets added this pass
- `docker-compose.test.yml`, `backend/pytest.ini`, `backend/tests/*`
- `frontend/src/dates.test.js`, `frontend/src/streaks.test.js`
- `vitest` dev-dep + `test` script in `frontend/package.json`

Backend tests run against a **real** Postgres (the app's behaviour lives in the
`.sql` files), resetting to a freshly-seeded baseline before each test so they
are order-independent.

---

# Feature pass — icon, hide-done, weekday schedules, delete fix, notes expansion

Status: **52 passed** (backend) · **48 passed** (frontend), 0 xfail.

## 1. App icon: favicon + iOS home-screen web app

`frontend/public/streak.png` was wired up only as a raw 1024×1024 favicon, so
browsers rescaled a 100 KB image for a 16px slot and iOS gave a home-screen
bookmark a page screenshot instead of an icon.

- **`frontend/scripts/make_icons.py`** (new) generates the icon set with Pillow;
  ImageMagick is not installed on the host. Note **`Image.LANCZOS`, not
  `Image.Resampling.LANCZOS`** — the enum does not exist in Pillow 9.0.1.
  Outputs are **committed on purpose**: `frontend/Dockerfile` copies `public/`
  wholesale, so `vite build` stays a pure copy and no build step is added. The
  script is not copied into the image.
- Outputs: `public/icons/icon-{16,32,48,152,167,180,192,512}.png`,
  `icon-{192,512}-maskable.png` (artwork inset to the 80% safe zone so Android
  can circle-crop it), plus `public/favicon.ico` and `public/apple-touch-icon.png`
  at the root, where iOS probes directly. Re-saving also drops the source's
  stray Photoshop EXIF block.
- The source is opaque RGB (white artwork on black), which is what Apple wants:
  iOS composites transparency onto black and applies its own rounded-rect mask,
  so the icons are deliberately full-bleed squares with no pre-rounding.
- **`frontend/public/manifest.webmanifest`** (new) — `display: standalone`,
  `#191919` theme/background, all four icons. `orientation` deliberately
  omitted so iPad isn't locked to portrait.
- **`frontend/index.html`** — icon/apple-touch/manifest links and the Apple
  standalone metas. `crossorigin="use-credentials"` on the manifest link is
  **load-bearing**: manifests are fetched with credentials omitted by default,
  so behind oauth2-proxy an anonymous request 302s to Google and iOS silently
  falls back to a plain bookmark named after `<title>`.
- **`frontend/nginx.conf`** — nginx's bundled `mime.types` has no `.webmanifest`
  entry, so the manifest was served as `application/octet-stream`. An exact-match
  location sets `default_type application/manifest+json` (which wins precisely
  because the extension is unknown).
- **`docker-compose.yml`** — `--skip-auth-route` for the manifest, `/icons/`,
  `favicon.ico` and `apple-touch-icon.png`. iOS fetches the home-screen icon
  from contexts (share sheet, springboard) that don't carry the session cookie.
  Verified the app root still 302s and `/api` still 401s.
- **`styles.css`** — `viewport-fit=cover` plus `black-translucent` draws content
  under the notch, so `.app` picks up `env(safe-area-inset-*)` padding (`0px`
  off iOS, so desktop is unaffected), and `html, body` get an explicit dark
  background — `.app` carries its colour inline, so iOS rubber-band overscroll
  was exposing white.
- **`App.jsx`** syncs the `theme-color` meta to `settings.background_color`,
  which the static manifest can't know about.

### Known iOS behaviour, documented rather than fixed
- An installed home-screen app has a **cookie jar separate from Safari**, so the
  first launch after install needs one Google login inside the app. With
  `--cookie-expire=720h` and refresh off, expect a re-login roughly monthly.
- The OAuth hop navigates off-scope to `accounts.google.com`. iOS 16.4+ handles
  this in an in-app browser that returns on the callback; older iOS can strand
  the session in Safari. Fallback: log in once in Safari at the Funnel URL, then
  re-add to the home screen.
- **Install from the Funnel URL, not `:3000`** — the LAN path bypasses auth and
  the install would then only work at home.
- **No service worker, deliberately.** Add-to-Home-Screen doesn't need one and it
  would fight both the 5 s poll and oauth2-proxy's 302s. Don't add
  `vite-plugin-pwa` later.

## 2. Hide-completed toggle

New `hide_completed` setting (`'1'`/`'0'` — the key/value store is string-only,
so no migration), toggled from a button beside Sync.

- **`App.jsx`** filters once into `visibleTasks` and passes it to both `Calendar`
  and `DayTaskList`, which is what makes one change cover desktop and mobile and
  automatically corrects `Calendar.jsx`'s week-height calculation. The task open
  in the modal is exempt, or checking it off yanks the card out from under the
  modal. Save is optimistic, matching `toggleDaily`.
- Sync and the toggle are wrapped in `.topbar-left` so `.topbar` keeps three
  flex children and the month nav stays centred.
- On mobile both buttons drop to their glyph, and `.month-nav` padding is
  tightened to buy back exactly the width the toggle costs — at 320px the row
  needs 308px, the same as before the toggle existed. (It already overflowed a
  320px viewport by 20px; that is unchanged, and ≥360px is clear.)
- Only calendar tasks are hidden. The daily bar always shows every habit so the
  streak stays readable.

## 3. Recurring daily tasks by day of week

`daily_tasks.days_mask INT NOT NULL DEFAULT 127` — bit 0 = Monday … bit 6 =
Sunday, matching `DAY_NAMES`, the Monday-first week and Python's
`date.weekday()`, so no index translation is ever needed. Added via
`ADD COLUMN IF NOT EXISTS` in `001_schema.sql` (which re-runs every boot), so
existing rows default to every-day and behaviour is unchanged until a toggle is
touched. Verified on the live database: 65 tasks and 119 completions intact.

- `daily_tasks_{list,create,update}.sql` carry the column; `DailyTask` /
  `DailyTaskIn` gain it, with `Field(127, ge=0, le=127)`. A mask of `0` is
  allowed and **parks** a task — due on no day, required by no streak.
- **`daily_streak_counts.sql` is now schedule-aware.** It previously counted any
  completion of an active task; since the endpoint only compares counts, a
  completion recorded on a day a task wasn't scheduled would stand in for a
  *different* task that genuinely was due. Guarded by
  `test_streak.py::test_completion_on_an_unscheduled_day_does_not_count`.
  Note `EXTRACT` returns `numeric` on PG14+, so the `::int` cast is required.
- **`get_streak` rewritten**: the required count now varies per day, so it reads
  the active tasks' masks instead of one global total. **A day with nothing
  scheduled carries the streak through** rather than breaking it — that is the
  one-line `if not required: return True`, pinned by
  `test_day_with_nothing_scheduled_does_not_break_streak`.
- **Two guards that did not exist before.** The old loop was implicitly bounded
  because `total >= 1`; with the vacuous rule, every task parked at mask 0 makes
  every day satisfied and the backward walk runs to date underflow. `if not
  any(masks)` is the load-bearing early return and `day >= start` bounds the walk
  to the 400-day window actually fetched. Regression test:
  `test_all_tasks_parked_means_zero` — it hangs rather than fails without them.
- `daily_tasks_count_active.sql` deleted; it went dead with the rewrite.
- **`dates.js`** gains `weekdayIndex`, `scheduledOn` and `EVERY_DAY`. Tasks with
  no mask count as every-day, which is why all nine existing `streaks.test.js`
  cases still pass untouched. Uses `??` and never `||` — `0` is a real value.
- **`dayTint`** scores only the tasks scheduled that day and returns `null` when
  none are. Consequence: an unscheduled day is **untinted** while still counting
  toward the streak, so a neutral gap can sit inside a green run. Neutral is
  deliberate — green would over-claim "you did everything".
- **`DailyBar`** filters by weekday *before* the 5-card cap (moved out of
  `App.jsx`), so a light day still fills the bar. With >5 tasks the bar now shows
  the first 5 *scheduled* rather than the first 5 by position; the settings title
  says so. A day with nothing due renders a muted "Nothing scheduled" chip
  instead of vanishing, which would jump the calendar.
- **`SettingsMenu`** gains a 7-button M/T/W/T/F/S/S row per task. `updateDaily`
  must send `days_mask` on **every** edit — PUT replaces the whole record, so an
  omitted mask silently resets the schedule to 127. Pinned by
  `test_update_without_days_mask_resets_to_every_day`.

## 4. Bug fix: deleting a task threw a client-side error

**Cause.** Clicking Delete fired two competing requests at the same row:
`mousedown` moved focus off the auto-focused `.desc-input` (or a notes
textarea) → `focusout` → `applyLive()` → `PUT /api/tasks/{id}`; then `click` →
`removeTask` → `DELETE /api/tasks/{id}`. When the DELETE committed first the PUT
matched zero rows, `tasks.py` returned 404, and `liveUpdateTask`'s catch popped
a blocking `alert("Saving failed: PUT /tasks/N -> 404")` right after the task
correctly disappeared. Intermittent, because the PUT usually won by a few ms.
This turned visible rather than silent when PUT-on-missing-row was hardened from
500 to 404 in the previous pass (bug fixes 1-2 above); nothing then taught the
client to stop writing to a row it was simultaneously deleting.

- **The fix**: `onMouseDown={(e) => e.preventDefault()}` on the Delete button —
  the pattern already used in `NotesEditor.jsx` — so no blur-save ever fires.
- **Defence in depth**: a `deleting` ref makes `applyLive` a no-op once a delete
  starts, covering keyboard activation.
- **A second, separate bug**: `removeTask` had no `try/catch`, unlike every
  sibling in `App.jsx`. A failed delete (offline, backend down) produced an
  unhandled rejection — no message, and `setModal(null)` never ran, so the modal
  stuck open. It now alerts and keeps the modal open so it's clear the task
  survived.
- **Latent hazard closed**: `req` in `api.js` called `res.json()`
  unconditionally. Every handler returns a body today, but switching one to
  `204` would break all three delete calls with "Unexpected end of JSON input".

Verified end-to-end: with the description dirtied and focused, Delete now emits
a lone `DELETE` with no trailing `PUT` and zero 404s in the backend log.

## 5. Notes expand on focus, two-stage dismissal

Notes were capped at 220px with `overflow-y: auto` — a small scrolling window
inside a larger one. Focusing them now expands them into the tab panel's space.

- `.modal.notes-expanded .notes-editor` drops the cap and uses `flex: 0 1 auto`:
  `flex-basis: auto` sizes the box to its content, `flex-grow: 0` stops short
  notes ballooning, and `flex-shrink: 1` lets it yield once the modal hits
  `max-height` — unblocked because `min-height` is an explicit `96px` rather than
  `auto`. The existing `overflow-y: auto` then produces a scrollbar *only* at
  that point. `.cat-grid`/`.mini-cal` hide while focused; the tab row stays so
  returning to the picker is one click. `overflow-y` must stay on
  `.notes-editor` — `position: sticky` resolves against the nearest scrolling
  ancestor, so the toolbar would otherwise slide over the description input.
- `.modal` also gained `max-height: 82dvh` so it tracks the shrinking viewport
  on mobile.
- **Two-stage backdrop dismissal** keys off `document.activeElement`, not React
  state: `mousedown` fires *before* `focusout`, so during a backdrop click the
  state hasn't caught up but the DOM is already authoritative. First click blurs
  the notes and returns; the second closes. A backdrop click while the
  *description* is focused closes immediately — the rule is specific to notes.
- **The reflow trap (this one is subtle).** Collapsing the notes moves `.tabs`
  and `.modal-actions` up by ~280px, so a `mousedown` on Close would shift the
  button out from under the pointer and `mouseup` would land elsewhere —
  **no `click` event at all**. Close, Delete, Cancel, Save and both tab buttons
  therefore carry `onMouseDown={(e) => e.preventDefault()}`, and blur explicitly
  where dismissal is also wanted. If one of these buttons ever turns flaky, it
  is a missing `preventDefault`, not a state bug.
- **`NotesEditor`** now containment-checks `relatedTarget` on focusin/focusout.
  These bubble, so the old bare `onBlur` fired `applyLive()` on every hop
  between two lines — one redundant PUT per line change. Its `pendingFocus`
  effect also became `useLayoutEffect`: merging the last line unmounts the
  focused textarea, and with `useEffect` the focus gap spans a paint, causing a
  visible collapse-and-re-expand flicker.

## Test assets added this pass
- `backend/tests/test_daily.py` — 7 `days_mask` cases, including the
  full-replace trap.
- `backend/tests/test_streak.py` — 4 schedule cases, including the
  infinite-loop regression test.
- `frontend/src/dates.test.js` — `weekdayIndex` and `scheduledOn`.
- `frontend/src/streaks.test.js` — `dayTint` under weekday schedules.

**Features 4 and 5 are not covered by the suites.** The frontend tests are
pure-logic by design (no jsdom, no testing-library — adding them would break the
"zero deps beyond react" property), and both features are interaction
behaviours. They were verified against the running app with an ad-hoc Playwright
script (38 checks: focus expansion, two-stage dismissal, the reflow trap,
hide-done on desktop and mobile, weekday filtering, and delete-without-alert).
That script is not committed; re-verify by hand using the checks in this section
if the modal is touched again.

---

# Layout pass — iOS focus zoom, wide two-column task modal

## 6. iOS zoomed the page in every time the notes were tapped

Tapping a notes line in the home-screen web app blew the viewport up until the
page was roughly the size of one note line, with a pinch as the only way back.

**It was never a focus-management bug.** Mobile Safari zooms in whenever a
focused text field computes to **under 16px**, scaling the viewport until that
field fills the width, and it does not zoom back out on blur. `.notes-line
textarea` was `14px`. This is also why it only started with the line-based
editor: the old notes were one tall `<textarea>` about as wide as the modal, so
"zoom until the field fills the width" was nearly a no-op. Each line is now its
own one-row `<textarea>`, so the same rule had something tiny to zoom to — which
is exactly the "screen becomes the size of the notes field" symptom.

So keeping the notes visually focused without focusing them would not have
helped, and could not work anyway: the field has to hold focus to receive
typing. The fix is the font size.

- New `@media (pointer: coarse), (hover: none)` block at the end of
  `styles.css` puts every text-entry control at `16px`. `hover: none` rides
  along because the two queries disagree on a tablet with a trackpad attached;
  a desktop matches neither and keeps the smaller type.
- **The other offender was `.panel-row input` at `13px`** — the streak-emoji,
  category-name and daily-task-name fields in the settings dropdown all zoomed
  the same way. Swept the whole app: **21 text-control instances across 8 app
  states, 0 now under 16px.**
- The bare `input`/`textarea`/`select` selectors are the net for anything added
  later; the class selectors exist only to out-specify the smaller rules above
  and depend on being later in the file.
- Deliberately **not** `maximum-scale=1` / `user-scalable=no` in `index.html`:
  that suppresses the same symptom by disabling intentional pinch-zoom too.

## 7. Desktop: notes beside the pickers, not on top of them

The modal was `520px` wide on any screen, so a desktop window was mostly
backdrop, and feature 5 above had focused notes *hide* the category/calendar
picker — a reasonable trade at phone width, pure loss at desktop width.

At `>=820px` the modal is `min(1040px, 94vw)` / `90dvh` and splits in two:
notes fill the left column, **both** pickers stack in a `380px` column on the
right, and the tab row is dropped because there is nothing left to switch.

- **`display: contents` on the three new wrappers** (`.modal-body`,
  `.modal-notes`, `.modal-picker`) is what keeps this from touching phones. Off
  the wide layout the wrappers leave the box tree entirely, so `.modal` is once
  again the *direct* flex parent of `.notes-editor`, `.tabs` and the panels —
  which both the feature-5 expansion sizing and the 12px modal gap depend on.
  The narrow layout is therefore unchanged, not re-implemented.
- **Both panels are always mounted now**, with `tab` only setting a `shown`
  class that `.cat-grid:not(.shown)` acts on. Conditional rendering would have
  thrown the tab state away on every resize across the breakpoint.
- `.modal .modal-notes .notes-editor` drops the `220px` cap and takes the column
  height in *both* focus states. It beats `.modal.notes-expanded .notes-editor`
  on source order, not weight — keep it last in the file.
- **The feature-5 reflow trap does not apply here, and that is load-bearing**:
  because the notes no longer resize on focus, nothing moves out from under the
  pointer. The picker buttons still got `onMouseDown={keepFocus}`, for a
  different reason — they now sit beside *live* notes, and blurring would fire
  an `applyLive()` PUT immediately followed by the button's own. Same save,
  twice.

## Verification

`npm test` still passes 48/48, but these are interaction and layout behaviours
and the frontend suite is pure-logic by design (see the note above). Verified
against the running app with an ad-hoc Playwright script — **44 checks**:

- iPhone 13: `pointer: coarse` matches, every modal and settings-panel field
  >=16px, plus the 21-control/8-state sweep.
- iPhone 13 regressions: tab row present, one panel at a time, notes still
  expand on focus and still hide both pickers, two-stage backdrop dismissal,
  and Close still fires with the notes focused (the reflow trap).
- 1440x900: modal 1040px wide and 715px tall, both pickers visible and to the
  right of the notes, notes column 588px tall, **zero movement of the pickers
  when the notes take focus**, a mini-day click that keeps notes focus and still
  persists, and a note edit that round-trips to the backend.
- 700x900: single-column fallback returns, and the tab selection survives a
  resize up to two columns and back down.
- Desktop keeps its `14px` notes — the touch guard does not leak.

That script is not committed; re-verify by hand from this list if the modal or
any text field is touched again.

---

# Ordering pass — manual task order within a day

## 8. Schema: `tasks.position`

`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0`,
added to `init/001_schema.sql` alongside the existing `days_mask` migration, so
it applies on the next startup and is a no-op after that. `tasks_list_range`
now orders by `due_date, position, id`.

**The `id` tiebreaker is the whole migration story.** Every row that predates
the column sits at the `0` default, so an existing database falls straight back
to creation order — exactly the order it displayed before. Covered by
`test_rows_without_a_position_keep_id_order`, which reaches past the API to
`UPDATE tasks SET position = 0`, since no endpoint can produce that state.

**Signed, and not a dense 0..n counter.** A new task takes
`MIN(position) - 1` for its day (`tasks_create.sql`), which puts it on top
without renumbering the day — one statement, so it cannot half-apply. Days that
are never dragged just drift negative, which nothing cares about. Only
`tasks_reorder` normalises a day back to `0..n-1`.

## 9. `PUT /api/tasks/reorder`

Takes `{due_date, ids}` and rewrites that day from the array order via
`unnest($2::int[]) WITH ORDINALITY`, then returns the day as it now stands.

- **Whole-day, not per-task**, so a reorder is one statement and a half-applied
  ordering is not a state the API can produce.
- **`WHERE ... AND t.due_date = $1` is a guard, not a filter.** Ids for another
  day — or for no task at all — match nothing and are skipped, so a tab that is
  one poll out of date can only ever renumber the day it was looking at. Two
  tests cover this directly.
- **Declared before `/tasks/{task_id}`.** Routes match in definition order and
  `{task_id}` is an `int`, so the other order would match `"reorder"` against it
  and answer with a 422. If this endpoint ever starts 422-ing, that is why.
- Moving a task to another day (`tasks_update`) drops it at the top of the new
  day, the same place a new task lands. Both sides of the `CASE` read the
  pre-update snapshot, so `due_date` there is the *old* value.

## 10. Drag to reorder — `useDragOrder`

`src/useDragOrder.js`, ~140 lines, no new dependencies (the "zero deps beyond
react" property still holds).

- **Pointer events, not HTML5 drag-and-drop**, which has never fired on iOS
  Safari — the platform this was asked for. One code path covers mouse, touch
  and pen.
- **The list is never reordered in the DOM mid-drag.** Geometry is frozen at
  `pointerdown` and each row is offset with a transform written straight to the
  node. That does two things: the rects the drop index is derived from can't
  shift underneath the pointer, and React never re-renders during a drag, so a
  sync can't interrupt one. Transforms are cleared and the new order committed
  in the same `pointerup`; React 18 flushes that before paint, so the rows never
  flash back through the old order.
- **Target slot is computed by counting**, not hit-testing — how many other
  frozen rows sit above the dragged row's centre. That stays defined when the
  pointer runs off either end of the list.
- **5px threshold** before a press becomes a drag, so tap-to-edit and
  double-click-to-edit survive a wobble; `wasDragged()` then swallows the click
  that `pointerup` still emits, which would otherwise open the task just dropped.
- `pointercancel` unwinds cleanly — it is the *normal* exit when the browser
  claims the gesture for a scroll, not an error path.
- **The 5 s poll is paused during a drag**, for the same reason an open modal
  pauses it: a refresh landing mid-drag would swap the rows out from under the
  pointer.

### Where the drag surface is
- **Mobile** (`DayTaskList`): a ☰ handle, rightmost in the row and outside the
  category chip. `touch-action: none` on it is load-bearing — without it Safari
  claims the gesture as a scroll and `pointermove` never arrives.
- **Desktop** (`Calendar`): the whole card. It only renders above 640px, where
  the pointer is a mouse and edit is a *double* click, so there is no competing
  gesture — and no ☰, keeping the desktop UI as it was. Each day gets its own
  `DayCards` component because the hook can't be called from inside the day loop.
- **`display: none` on `.drag-handle` at base**, not just outside the phone
  query, so it stays hidden if `.day-list` is ever shown wider.

### The bug the tests missed and the screenshot caught
The handle's three bars rendered at **width 0**: Chrome's UA stylesheet sets
`align-items: flex-start` on `<button>`, so the zero-width spans never
stretched. `isVisible()` passed the whole time because the *button* had a box.
Fixed with an explicit `align-items: stretch`, and the test now asserts the bars
themselves have real width and a painted colour.

## 11. `#00c0ab` on the first task of today

`firstTaskIdOn(visibleTasks, todayIso())` in `tasks.js`, recomputed every
render — nothing is stored on the task, so the colour follows a drag, a delete,
a new task or a date change with no extra bookkeeping.

- Derived from the **visible** list, so `hide done` retiring the top task
  promotes the next one rather than stranding the colour on a hidden row.
- The rule lives **last in `styles.css`** on purpose: `.task-card.first-today`
  and `.task-card.done` have equal weight, so source order is what puts the
  highlight over the grey completed background. A completed first task keeps its
  strikethrough and filled circle but wears the teal — being today's next thing
  is the more useful signal. Flip the two rules if that judgement is wrong.

## 12. `hide done` and partial reorders

A drag only rearranges rows the user can see, but the endpoint renumbers a whole
day — so a bare visible list would leave hidden done tasks on stale positions
that resurface when `hide done` goes off. `applyVisibleOrder` deals the visible
ids back into the slots the visible tasks held and leaves everything else where
it was, and the *whole* day is what gets sent.

## Verification

- **Backend: 64 passed** (was 51), 13 new in `test_tasks.py` covering
  top-insertion, per-day scoping, reorder idempotency, the stale-id guard,
  position survival across an ordinary update, the cross-day move, and the
  migration-compat claim.
- **Frontend: 73 passed** (was 48), 25 new in `src/tasks.test.js` for
  `orderTasks` / `moveItem` / `applyVisibleOrder` / `firstTaskIdOn`.
- **Ad-hoc Playwright, 35 checks** — the drag itself is an interaction, so it is
  not in the pure-logic suite: mouse drag on the desktop calendar, a *real*
  touch drag on mobile via CDP `Input.dispatchTouchEvent`, the 3px wobble that
  must not reorder, no leftover transforms after a drop, tap- and
  double-click-to-edit still working afterwards, the handle's geometry and bars,
  the teal moving on drag and on delete, exactly one highlighted row, and a
  reorder under `hide done` leaving the hidden task in its middle slot.
  Re-verify by hand from this list if the drag or the ordering is touched again.

---

## Multi-node sync: backups, failover, buddy backup (2026-08-26)

Redundancy pass: every machine now runs this same stack with a role from
`.env` (`host` / `backup` / `mirror`), merging two-way so the app keeps
working through a host outage and reconciles afterwards. **Backend: 82
passed** (20 new in `tests/test_sync.py`) · **Notes: 78 passed** (11 new in
`tests/test_filesync.py`) · **Frontend: 73 passed**, builds clean. Verified
live with two full stacks: seed/pull convergence, both directions, notes
files, an outage with queued writes, a forced two-sided edit conflict, its
restore propagating back, deletion tombstones, and token auth.

- **Schema** (`backend/app/sql/init/003_sync.sql`): every replicated row
  gains a global `uid` + `updated_at` (kept honest by a touch trigger that a
  sync import bypasses via `SET LOCAL streak.sync`), hard deletes are
  recorded in `sync_deletions`, merge losers in `sync_conflicts`, per-peer
  watermarks in `sync_peers`. Backup/mirror nodes skip the seed (`db.py`) so
  seeded rows arrive from the host under the host's uids.
- **Sync core** (`backend/app/sync.py`, `routers/sync.py`): export/import by
  uid, last-writer-wins with conflict logging when both sides changed since
  the watermark; FKs travel as `*_uid`, serial ids never leave a node. The
  engine loop (backup: ~30 s, mirror: ~10 min) pulls then pushes against the
  host. Machine routes live under `/api/sync/peer/*` behind a pre-shared
  `X-Sync-Token` (the only routes oauth2-proxy skips); status/conflicts stay
  behind Google.
- **Notes sync** (`backend/app/notesync.py`, `notes/.../routers/sync.py`):
  rsync-shaped — manifest with sha256 + mtimes (writes preserve mtime),
  tombstones recorded on delete *and rename* (renamed targets get an
  explicitly-later mtime; file clocks are coarser than `time.time()`),
  concurrent edits keep the loser as a "(conflict …)" copy.
- **Frontend**: `failover.js` walks the configured origin chain (Settings →
  Backups & failover; cached in localStorage) top-down and stops at the first
  live node; `public/sw.js` is a shell-only, network-first service worker so
  the PWA can open while its origin is down (never touches /api, /oauth2,
  /notes); ⚠ badge + `ConflictsModal.jsx` is the bare-bones resolver.
- **Buddy backup**: `docker-compose.mirror.yml` runs a friend's full stack
  beside your own, locked to *their* Google allowlist (host serves, can't
  log in); mirrors only from the owner's host. Alternative encrypted mode:
  the host pushes AES-256-GCM snapshots to `/api/sync/peer/blob` (buddy
  stores ciphertext only), restored by `scripts/restore_blob.py`.
- **Windows companion** (`companion/`): Electron tray app that clones/updates
  the stack from GitHub (daily + on demand), manages Docker, shows the web
  app in a native window, and installs buddy mirrors from two pasted files.

---

## 2026-09-06 pass: bug fixes + five features

### Bug fixes

1. **Failed task save no longer disappears silently.** `App.jsx`'s `saveTask`
   had no error handling: with the server unreachable, Save rejected as an
   unhandled promise, the modal stayed open and nothing said why. It now
   alerts, resyncs, and keeps the modal (and the typed text) open.
2. **Double-submit guard on task creation.** Enter-then-click (or a doubled
   Enter) could POST the same new task twice; `TaskModal.jsx` now ignores
   saves while one is in flight.
3. **Notes app: rename failures are surfaced.** `renamePage` in
   `notes/frontend/src/App.jsx` swallowed errors (e.g. a 409 filename
   collision); it now shows the banner and refreshes the tree.

### Features

1. **Enter saves a new task** (`TaskModal.jsx`): Enter in the description
   field of a new task saves and closes; on an existing task it commits the
   live edit (blur).
2. **Today is blue in the reschedule mini-calendar** (`TaskModal.jsx`,
   `.mini-day.today`); the dark-red selected due date still wins when both.
3. **First-run tour** (`components/Onboarding.jsx`): four short cards on
   first open (per-browser, `localStorage` `streak.onboarded.v1`),
   reopenable via Settings → "Show intro tour".
4. **Cyberpunk skin** (Settings → "Cyberpunk skin", setting
   `cyberpunk_skin='1'` so it follows the account): scoped `.app.cyberpunk`
   overrides — near-black grid ground, signal-red accents, cyan for
   today/next-task, angular clipped buttons, mono uppercase chrome. The
   sticky-notes pad deliberately keeps its leather-and-paper look.
5. **Note-page icon** (`components/NoteIcon.jsx`): a small Notion-style page
   glyph after the task text on calendar cards and the mobile day list when
   the task's notes field has non-whitespace content.

Verified: frontend vitest 73/73 passed; both frontends build clean. Backend
untouched.

## 2026-09-06 pass: drawing input overhaul (Streak Notes)

### Fixes

1. **Palm rejection rebuilt** (`notes/frontend/src/components/DrawingPage.jsx`):
   the single `gestureRef` meant a palm touching down mid-stroke *replaced* the
   active pen gesture — the stroke's ink vanished uncommitted and the palm
   started panning the page. Finger pans now live in their own `panRef`, so a
   touch can never steal the pen's gesture. A touch is rejected outright (for
   its whole lifetime) when the pen is down, when the pen was active within
   600 ms (the pause between characters is when a writing hand shifts), when
   its contact patch is palm-sized (>34 CSS px), or when it isn't the first
   touch. A pen-down cancels any palm-started pan — the pen always wins.
2. **Toolbar no longer "highlights redo" while handwriting**: touch
   pointer-downs on the stage are now `preventDefault`ed (rejected palms
   included), so they can't synthesize mouse/click/focus events on the toolbar
   behind the hand; toolbar buttons prevent default on pointerdown so a tap
   never leaves one focused (`DrawToolbar.jsx`); the toolbar is
   `user-select: none` so a stray double-tap can't text-select the ⟳ glyph;
   and `.tool:hover` only applies under `@media (hover: hover)` so the
   highlight can't stick on touch (`styles.css`).
3. **No more Copy / Look Up popping near the title**: with the toolbar
   unselectable, stray palm double-taps moved up to the next selectable text —
   the topbar's page title and the rename input. The topbar is now
   `user-select: none` / `-webkit-touch-callout: none` (chrome, not content),
   and the drawing page's `.md-title` input applies the same palm test as the
   canvas on touch pointer-downs (pen recently active, palm-sized patch, or a
   stroke in flight ⇒ `preventDefault`), so a resting hand can't focus it —
   a deliberate pencil or fingertip tap still renames.

### Behaviour

1. **Streak Notes opens on the first non-sticky section**
   (`notes/frontend/src/App.jsx`): the app-owned Sticky Notes section is
   skipped when picking a default section (on load and after a section
   delete), unless it's the only section.

Verified: notes frontend vitest 98/98 passed; build clean. Backend and task
app untouched.

## 2026-09-08 pass: Linux companion (Ubuntu / Debian / Mint)

### Companion (`companion/`)

1. **Cross-platform main process** (`main.js`): the Windows-only assumptions
   are gone. Install-folder default is `C:\Streak` on Windows and `~/Streak`
   elsewhere; the settings page reads it from `config:get` instead of
   hardcoding. The Docker check now runs `docker info` + `docker compose
   version` and reports *why* Docker isn't usable — not installed, daemon
   stopped, user not in the `docker` group (the classic Linux first-run
   failure), or compose v2 plugin missing — with the exact command to fix
   it, per platform.
2. **Reachable without a tray.** GNOME hides tray icons unless the
   AppIndicator extension is on (Ubuntu ships it; stock Debian GNOME doesn't),
   so the app window now has a **Companion** menu bar (hidden until Alt) with
   the same items as the tray menu, tray creation is wrapped in try/catch, and
   the app is single-instance (`requestSingleInstanceLock`): relaunching from
   the app grid raises the existing window instead of adding a second tray
   icon and update timer. The tray and menu share one `controlItems()` list.
3. **Linux login autostart**: a Settings checkbox (Linux only) writes/removes
   `~/.config/autostart/streak-companion.desktop`, launching the companion
   with the new `--hidden` flag (stack up + tray, no window). `Exec` points
   at the AppImage, the installed binary or `electron .` depending on how
   it's running. Not offered on Windows, where Docker Desktop's own
   start-at-sign-in covers it.
4. **Packaging** (`package.json`): `dist:linux` builds a `.deb` (Ubuntu /
   Debian / Mint — the targets this is built for) and an AppImage.
   `build/icons/` holds a 16–512 px hicolor set generated from
   `build/icon.png`; `build/linux-after-install.sh` is electron-builder's
   stock postinst plus a fix for Ubuntu 24.04+ / Mint 22+: their AppArmor
   restriction on unprivileged user namespaces breaks Chromium's namespace
   sandbox, and the stock script's `unshare` probe runs as root so it never
   notices — when `apparmor_restrict_unprivileged_userns=1` the setuid
   `chrome-sandbox` is used instead. `.deb` recommends `git`. Version bumped
   to 1.1.0; `homepage` added (fpm refuses to build a deb without one).
5. **GitHub workflow** (`companion-release.yml`, now "Build Streak
   Companion"): a `linux` job on ubuntu-latest beside the Windows one, both
   uploading run artifacts (`streak-companion-windows`,
   `streak-companion-linux`); a `release` job gathers both into a single
   GitHub Release on `companion-v*` tags.
6. **Docs**: `companion/README.md` rewritten for both platforms — a Linux
   requirements section with a Docker-Engine-from-Docker's-apt-repo recipe
   that works unchanged on Ubuntu, Debian and Mint (Mint has no repo of its
   own; the script maps it to its Ubuntu base via `UBUNTU_CODENAME`, LMDE to
   Debian), the `docker` group step, Tailscale, why no auto-login trick is
   needed on Linux (Docker Engine starts at boot; every container is
   `restart: unless-stopped`), per-platform download/install table, source
   build commands, and a *Linux notes* section (GNOME tray, AppImage sandbox
   on 24.04, file locations, permission-denied fix). Main README's
   backups section now says Windows *and* Linux.

Verified: `.deb` + AppImage built with electron-builder 25.1.8 / Electron
33.4.11 in a `node:20` container (host has no node); deb inspected — control
metadata, 7 icon sizes, postinst with the AppArmor fallback, desktop entry;
packaged binary booted under Xvfb. Not tested on a real Ubuntu 24.04 desktop
session (this machine is 22.04, kernel 5.15) — the AppArmor path is from the
documented Chromium/Electron behaviour there, not observed.

---

## 2026-09-19 pass: Notion-style task modal

The open-task modal kept its shape — title row, notes, picker column, action
row — but the two pieces that read least like a document were rebuilt.

1. **Title** (`.desc-input`): 26 px / 30 px on wide screens, bold, still
   left-aligned (not centred), placeholder now "Untitled". The underline is
   `transparent` until the field is focused, so a resting modal reads as a
   page rather than a form. The iOS 16 px focus-zoom guard had `.desc-input`
   in its blanket 16 px list, which would now *shrink* the title on touch
   devices; it was pulled out and given `.modal-header .desc-input { 26px }`
   in the same block, specific enough to beat the bare `input` selector. The
   header check circle grew to 22 px to sit beside the bigger type
   (`:not(.checked)` on the ring colour so the done state keeps its green).
2. **Category is a dropdown** (`CategorySelect` in `TaskModal.jsx`): the 4×n
   grid of square colour tiles is gone. The category and the deadline are now
   Notion property rows — icon + label on the left, value on the right — and
   the category value is a chip that opens a searchable menu (filter field,
   "Select a category", coloured option chips with a ✓ on the current one, and
   a "Clear category" footer). Enter picks the first match.
   The menu closes on an outside mousedown **in the capture phase, with
   `stopPropagation()`**: React's listeners sit on the app root, below
   `document`, so the same click can't also reach the backdrop and close the
   whole modal. Escape closes it and returns focus to the trigger. On open it
   calls `scrollIntoView({ block: 'nearest' })`, which does nothing unless the
   surrounding column clipped it.
3. **Tabs removed**: with the category down to one row there is nothing to tab
   between, so the properties and the mini calendar are both always on screen
   in either layout, and the `tab` state, `.tabs`, `.cat-grid`, `.cat-tile`
   and the `:not(.shown)` hiding rule went with them. Expanded notes now hide
   `.modal-props` + `.mini-cal` (was `.cat-grid` + `.mini-cal`). The cyberpunk
   skin follows: square menu, monospace uppercase property labels, red hover,
   and its `.desc-input` underline moved to `:focus`.

Verified: `npm run build` and the 73 frontend unit tests pass in
`node:20-alpine`; the modal was rendered from the real stylesheet in headless
Firefox at 1200 px and 420 px, menu open and closed, plain and cyberpunk.

---

## 2026-09-19 pass: sync status menu

Prompted by a change that "didn't show up": the live containers had been
running the 2026-09-06 frontend image for thirteen days, and nothing in the
app could say so. The sync button now carries the answer.

1. **Split control** (`SyncMenu.jsx`): the Sync button still syncs on click;
   a caret beside it opens a status panel. Both halves are tinted by the
   connection state, so the topbar shows trouble before the panel is opened.
2. **State machine** (`syncstate.js`, tested in `syncstate.test.js`):
   `offline` → `cached` → `stale`/`down` → `connecting` → `ok`, worst first.
   `cached` — "Cached by browser, unable to connect" — is the one that needed
   new plumbing: `public/sw.js` now drops a timestamped `/__served-from-cache`
   marker in its shell cache whenever it answers a *navigation* from that
   cache, and `shellcache.js` reads the marker once at boot and consumes it,
   so it can only ever describe the current page load. `App.jsx` tracks
   `lastSyncAt` / `syncError` off the existing 5 s poll to drive the rest.
3. **Panel contents**: state headline and explanation, last update, whether
   the page came from the server or the browser cache, auto-refresh state,
   last error; then the peer-sync block for a node with a `SYNC_ROLE` (role,
   upstream host, upstream reachability, last peer sync, last peer error) or
   "single node — peer sync is off"; a shortcut into the ⚠ conflict resolver;
   the build stamp; and `Sync now`, which also pokes `POST /sync/now` on a
   node that has a sync role.
4. **Build stamp + update check**: `vite.config.js` defines `__BUILD_ID__`
   (build timestamp), shown in the panel footer. While the panel is open it
   fetches `/` with `cache: 'no-store'` and compares the hashed entry bundle
   named there with the one this tab is running (`import.meta.url`); a
   mismatch offers "The server has a newer build than this tab — reload",
   which deletes the shell cache and reloads. That is exactly the state this
   pass started from, now visible from inside the app.

Also corrected in `CLAUDE.md`: the live deployment does **not** run from a
different checkout. Its compose labels point at this directory; the project
is just named `streak_app`. Source edits are invisible until
`docker compose up -d --build frontend`.

Verified: 88 frontend unit tests pass (15 new); the panel was rendered from
the real stylesheet in headless Firefox in both the healthy and the
cached-and-offline state; the rebuilt container serves the new bundle, the
new `sw.js` and a build stamp matching the image.

## 2026-09-23 pass: CLAUDE.md swept against the code

Documentation only — no app code changed. Every claim in `CLAUDE.md` was
checked against the source, and the gaps a later agent would trip over were
filled in.

**Corrections**

1. **"Everything runs behind one nginx + oauth2-proxy" was misleading.**
   `frontend` publishes `3000:80` on every interface and that path bypasses
   oauth2-proxy entirely; oauth2-proxy binds `127.0.0.1:4180` and only fronts
   the Tailscale Funnel path. Now stated explicitly as two access paths, one
   authenticated.
2. **"The only unauthenticated routes are `/api/sync/peer/*`" was wrong.**
   oauth2-proxy also skips `/api/notes/sync/`, `manifest.webmanifest`,
   `/icons/`, `favicon.ico` and `apple-touch-icon.png`.
3. **Frontend test description was incomplete** — `syncstate.test.js` was
   missing, and the notes frontend's own 98-test suite (markdown parser plus
   the whole drawing engine) was not mentioned at all, only its build.
4. **The `npm install` caveat for `notes/frontend` is stale**: both
   `node_modules` trees currently carry their dev deps, so `npx vitest run`
   and `npm run build` work as-is. Kept as a fallback rather than a step.
5. **The notes backend test command needs `cd notes` first** (its build
   context is `./backend`); "same pattern" was not enough to run it.
6. **Settings keys were listed as two examples.** The real set is
   `background_color`, `cyberpunk_skin`, `failover_origins`,
   `hide_completed`, `streak_emoji`, plus internal `seeded` filtered out of
   `GET /settings`.

**Added**

- Encrypted buddy snapshots (`blob_job`, AES-256-GCM, `BLOB_KEEP`,
  `scripts/restore_blob.py`) — previously undocumented entirely.
- `docker-compose.mirror.yml` (project `streak_mirror`, port 3100).
- That `SYNCED_TABLES` covers four tables only; completions, settings and
  deletions have hand-written export/import blocks, and `sync_conflicts` /
  `sync_peers` never sync.
- The 10 s watermark `SLACK`, the NTP assumption, and why backup/mirror nodes
  skip the seed.
- Streak endpoint specifics: 400-day walk, unscheduled days carry the streak,
  and `daily_streak_counts.sql` excluding off-schedule completions.
- `tasks_reorder.sql`'s `due_date` guard, the `seeded`-flag seeding gate, and
  `GET /api/health`'s role in failover.
- Frontend: the 401-reload rule in `api.js`, `syncstate.js` as the tested
  state machine, the `__BUILD_ID__` / entry-asset comparison, the failover
  chain's strict ordering and `no-cors` probe, and the `streak-notes.tools.v1`
  localStorage key.
- Notes app: ids as base64url paths, etag-as-content-hash, the three-attempt
  409 merge loop, the rename/tombstone mtime ordering, the sticky section's
  403s and markdown-only rule, the size limits, magic-byte image sniffing,
  and a map of the five `draw/` modules.
- Test baselines, all re-run and green on this pass: backend **82**, notes
  backend **78**, task frontend **88**, notes frontend **98**.

---

## 2026-09-23 pass: mobile horizontal overflow

Two regressions from the 2026-09-19 pass, both showing up on a phone as the
same symptom — the layout shunted sideways with a bar of dead space down the
right edge. Measured in headless Firefox at 320/360/390 px against the real
stylesheet, before and after.

1. **The category dropdown was wider than the room it had.** `.prop-menu` was
   `left: 0; width: max(100%, 250px)` inside `.prop-value`, which is only what
   the 104 px label leaves — ~230 px at 390 px. So it hung 22 px past the
   modal. That alone would just be ugly, except `.modal` sets `overflow-y:
   auto`, and an overflow-y that isn't `visible` makes overflow-x compute to
   `auto` too: the modal quietly became a horizontal scroller. The menu's
   `scrollIntoView({ block: 'nearest' })` then scrolled it, because `inline`
   defaults to `'nearest'` as well — 36 px sideways, clipping the title, the
   notes and the Delete button, and the scroll stayed put after the menu
   closed. Now the menu hangs off the value's *right* edge with
   `max-width: min(320px, calc(100% + 112px))`, so it can grow leftwards
   across the label but never past the row; and the open-nudge is a hand-
   written vertical-only scroll (`scrollParent()` walks for the real scroller,
   since `display: contents` moves it between breakpoints).
2. **The sync caret pushed the topbar past the viewport.** `.topbar` is one
   non-wrapping row of content-sized buttons with no `min-width: 0`, so it
   refused to be narrower than its contents: a fixed 374 px. Adding the 25 px
   caret took it over the line — at 360 px the *document* measured 390 px
   wide, i.e. 30 px of horizontal page scroll with the avatar off the edge
   (it was 5 px before the caret, 70 px at 320 px). The groups now shrink,
   `.settings` opts out so the avatar stays round, and `.month-title` is the
   shock absorber: `min-width: 0` plus `nowrap`/`ellipsis`. To keep it from
   actually ellipsising, the mobile row also tightens its gaps and the caret's
   padding, and the month name renders abbreviated below 640 px (`.month-long`
   / `.month-short`, one shown at a time) — "Sep 2026" instead of a clipped
   "Septemb…". The cyberpunk skin sets the same title in spaced-out uppercase,
   so it gets a slightly smaller size there to fit the same slot.

After: the document is exactly viewport-wide at 320, 360 and 390 px, and the
open menu sits inside the modal with `scrollLeft` at 0 in both skins and both
modal layouts.

Verified: 88 frontend unit tests pass, `npm run build` is clean, and the
topbar and the open category menu were rendered from the real stylesheet in
headless Firefox at 320/360/390/1200 px, plain and cyberpunk.

---

# Sticky-notes pass — unreadable notes under the skin, and one launcher bar (2026-09-23)

## 1. Black blocks behind every quick note (bug)

With the cyberpunk skin on — which this deployment has (`cyberpunk_skin = '1'`)
— every line of a sticky note sat on a near-black panel, under the pad's own
dark ink on yellow paper. Unreadable, and not phone-specific; it was just as
broken on desktop.

`.cyberpunk .notes-editor { background: #0d0d11 }` was the culprit. The sticky
pad reuses the task modal's `NotesEditor` and undresses it with
`.sticky-editor { background: transparent }` — a single class, which the skin's
two-class rule outweighs. The skin's own header comment says the pad keeps its
leather-and-paper look on purpose, so the rule now steps around it:
`.cyberpunk .notes-editor:not(.sticky-editor)`.

Checked the rest of the skin for the same leak: `.cyberpunk .check-circle.checked`
is outweighed by `.sticky-editor .notes-line.check .check-circle.checked`
(4 classes to 3), and every other colour inside the pad is set explicitly, so
this was the only one.

## 2. The floating icon becomes a launcher bar

The drag-anywhere sticky-note FAB is gone. In its place, one `.sticky-launch`
button — yellow paper, the note icon, "Quick notes", a `+` — rendered in
**ordinary document flow** directly after `DayTaskList`:

- **Phone (≤640px):** a full-width bar under today's tasks.
- **641px and up:** the *same element*, `position: fixed` in the bottom-right
  corner at `calc(24px + env(safe-area-inset-*))`. One element in two layouts,
  so there is no second copy to keep in step.

Consequences, all in `StickyNotes.jsx`:

- Dropped: pointer-drag handlers, `clampPos`/`cornerPos`/`readPos`, and the
  `streak.sticky.pos.v1` localStorage key (the position is no longer the
  user's to choose). Removed from the key list in `CLAUDE.md`.
- The pad is anchored off the launcher's measured rect instead of the icon's
  stored coordinates. Measured in a **layout** effect so the pad is never
  painted in the fallback corner first. No scroll listener: only the desktop
  layout reads the anchor, and there the launcher is `position: fixed`.
- On a phone the pad is pinned to the bottom of the viewport rather than hung
  off the launcher — the launcher scrolls with the page there, so anchoring to
  it would fling the pad off-screen on the first scroll.
- **A tap outside now closes the pad.** This is load-bearing, not polish: the
  old floating icon sat *above* the pad and doubled as the close button, and a
  phone-sized pad covers the launcher. The launcher itself is excluded from the
  handler, or its own click would close and immediately reopen.
- `Onboarding.jsx` step 4 described "the floating notepad icon"; it now
  describes where the bar actually is in each layout.

## Verification

- `vitest run` (task frontend): **88 passed**, unchanged — nothing here has a
  unit test; `StickyNotes.jsx` exports only `titleOf`/`stamp`, neither touched.
- `npm run build` (task frontend): clean.
- Not rebuilt into the running `streak_app` stack — the live deployment still
  serves the previous bundle until `docker compose up -d --build frontend`.

---

# 2026-09-23 — Streak Notes: palm rejection, and pages that open when you make them

Three reports, all from an iPad: the Pencil "randomly highlights action icons"
while writing, the notebook opens on Quick notes, and a new page does not
become the page you are looking at.

## 1. Palm rejection off the canvas

The old guard was in two hand-written copies, one on the stage and one on the
page title, and nothing at all on the toolbar — which is where the reported
symptom was coming from. A resting hand landing on the bar picked a pencil or
fired undo, and iOS left the button lit afterwards.

Two things were wrong beyond the missing coverage:

- **The wrong event.** Both copies called `preventDefault()` on `pointerdown`.
  That does not stop the `click`, the focus, or the simulated `:hover` iOS
  synthesises from a touch — only cancelling `touchstart` does. The old guard
  was "preventing" events that were never the ones causing the highlight.
- **The wrong scope.** A React `onPointerDown` cannot stop a sibling's
  `onClick`: React's listeners all sit at the app root, so anything attached
  inside the tree is already too late.

Now: `notes/frontend/src/draw/palm.js` holds the decision as one pure
predicate, and `DrawingPage` installs it in both places that need it.

- **The canvas** keeps its own `pointerdown` test, now calling `isPalm()`.
- **Everything else** — toolbar, title, top bar, sidebar — is covered by
  native **capture-phase listeners on `document`**, which run before anything
  React would dispatch. They cancel `touchstart`, remember the refused
  `Touch.identifier`, and cancel that touch's `touchend` too, so a click
  Safari synthesises on release is matched to the touch that caused it rather
  than guessed at from a time window.

What counts as a hand:

- The pen tip is down, anywhere on the page.
- The pen tip was down recently — 700 ms on the canvas, 1200 ms on the chrome.
  The chrome waits longer because a refused pan is repeated and a stray undo
  is not. "Recently" now means **contact**, not sight: the old code stamped
  the clock on every pen `pointermove`, and a Pencil streams those the whole
  time it hovers, so merely holding the pen over the page would have locked
  touch out indefinitely. `e.buttons` gates it.
- The contact patch is wider than 34 CSS px, read from `Touch.radiusX/radiusY`.
  The old code read `PointerEvent.width/height`, which iOS pins at 1 — the
  size test had never once fired on the device it was written for.
- A gesture already has an owner, so this is a second contact.

Two asymmetries fall out of the event order:

- The Pencil raises touch events too, so stylus touches are skipped outright.
  Without that the gate reads its own pen `pointerdown` as "pen is down" and
  refuses every toolbar tap made with the pen — the fix would have broken the
  toolbar for the pen while fixing it for the palm.
- `pointerdown` fires *before* `touchstart`, so on the canvas the stage has
  already accepted a touch as a finger pan by the time iOS reports its width.
  A pan that turns out to be palm-sized is now retracted and the scroll put
  back, at most one frame late.

Belt and braces in CSS: `-webkit-tap-highlight-color: transparent` on the
toolbar and the title, so anything that does slip past at least does not flash
a grey box. `.tool.on` is the real feedback and survives it.

A stuck `penDown` would deaden every button on the page, so a pointer released
outside the window (`blur`) clears it.

## 2. A new page now opens, maximized

This was one bug wearing two hats, and the same bug behind the rename that
"bounced to the top of the section".

`App.jsx` runs a repair effect on every tree change that puts the selection
back on something that exists. Every mutation set the selection **and then**
refreshed the tree — two ticks, and in the render between them the id the
repair was judging did not exist yet, so it faithfully repaired it back to
whatever had been selected before. A created page was selected for one frame
and then dropped.

- The rule moved to `notes/frontend/src/selection.js` as a pure function, with
  tests.
- Every mutation now goes through one `mutate()` helper that runs the call,
  fetches the tree, and commits the tree and the selection in the **same
  synchronous block** so React batches them into a single render. That covers
  create, delete and rename for both sections and pages; `run()` is gone.
- Deleting a page no longer flashes the error banner: the old ordering could
  briefly re-select the page that had just been deleted and 404 fetching it.
- A new page also collapses the sidebar. It is made to be written in, and on
  an iPad the two lists cost a drawing about a third of the canvas. A new
  *section* keeps the sidebar — an empty section's next step is the `+ Page`
  button beside it.

## 3. Quick notes as the default

Already correct in source (`sections.find((s) => !s.sticky)`), so this one was
a live-deployment lag, not a code fix — the running container still serves the
bundle from before that change. It is now covered by a test in
`selection.test.js` so it cannot regress, and the rule keys off the server's
`sticky` flag rather than the section's name.

Also fixed the New page menu, which still described hand-drawn pages as a
"Blank canvas — placeholder for now".

## Verification

- `vitest run` (notes frontend): **117 passed** (was 98) — 11 new for
  `palm.js`, 8 for `selection.js`.
- `vitest run` (task frontend): **88 passed**, unchanged.
- Notes backend: **78 passed**, unchanged — nothing server-side moved.
- `npm run build`: clean for both frontends.
- Not rebuilt into the running `streak_app` stack. The palm fix cannot be
  tested from a browser until `docker compose up -d --build frontend`, and
  a tab already open keeps its old bundle until reloaded.

# 2026-09-23 — Escape closes the task modal

Escape inside a task view now does exactly what the primary button does:
**Close** for an existing task (`applyLive()` then dismiss, since edits to an
existing task are already live) and **Save** for a new one, so a half-typed new
task is committed rather than thrown away. Failure behaves the same too — the
save handler leaves the modal open on an error, so nothing is silently lost.

One `useEffect` in `TaskModal.jsx`, listening on `document` in the **bubble**
phase. That phase is the whole trick: the category dropdown's own Escape
handler is a *capture*-phase listener on `document` that calls
`stopPropagation()`, so while that menu is open Escape closes the menu only and
never reaches the modal. `e.defaultPrevented` is skipped for the same reason —
anything that has already claimed the key keeps it. The effect has no
dependency array on purpose: `save`/`close` close over every field of the form,
and re-binding one listener per render is cheaper than reasoning about a stale
closure.

## Verification

- `vitest run` (task frontend): **88 passed**, unchanged.
- `npm run build` (task frontend): clean.
- Not rebuilt into the running `streak_app` stack — needs
  `docker compose up -d --build frontend`, and an open tab keeps its old bundle
  until reloaded.

# 2026-09-23 — A new daily task no longer eats the streak

Adding a daily habit used to reset the streak counter to at most 1. The streak
walk judges each past day against the schedules **as they stand now**
(`_required_on` runs over the current `days_mask` list), so a task created
today was counted as required — and missed — on every day behind it, and the
run ended at the first one.

`POST /api/daily` now checks the new task off on every day it *would* have been
due before the day it was created. `daily_completions_backfill.sql` does it in
one statement: `generate_series` over the window, cross-joined to the row that
was just inserted and filtered by that row's own `days_mask` with the same
ISODOW expression `daily_streak_counts.sql` uses. Reading the mask from the row
rather than taking it as a parameter is deliberate — it cannot disagree with
the task that was just created. Off-schedule days are skipped: the streak query
already ignores off-schedule completions, so rows there would buy nothing and
only muddy the history.

Details that matter:

- **The creation day is not backfilled.** You still have to actually do it
  today; the streak simply doesn't break behind you.
- **The window is `STREAK_WINDOW_DAYS = 400`**, now a named constant in
  `routers/daily.py` shared with the streak walk that already used 400. No
  streak longer than the walk can be counted, so there is nothing further back
  worth protecting — and the backfill stays bounded at ~400 rows.
- **`today` is a query param on the create route**, for exactly the reason
  `/api/daily/streak` already takes one: the server timezone must not decide
  which day a client is on. It is optional and falls back to the server's date,
  so a client that predates this still creates tasks. `api.js` passes
  `todayIso()`; `SettingsMenu.jsx` is the only caller.
- **Insert and backfill share one transaction.** A task that exists without its
  backfill is precisely the broken streak this is here to prevent.
- Backfilled rows are ordinary completions, so they ride the normal sync path
  (the hand-written `completions` block in `sync.py`) to every node.

## Verification

- Backend suite: **90 passed** (82 before; 6 new backfill tests in
  `test_daily.py`, 2 new streak tests in `test_streak.py`). The new streak
  tests pin both halves: a task added mid-streak leaves the days behind it
  intact, and ticking it today restores the full count.
- `vitest run` (task frontend): **88 passed**, unchanged. `npm run build`:
  clean.
- Not rebuilt into the running `streak_app` stack — the backend change needs
  `docker compose up -d --build frontend` (which recreates the backends it
  depends on), and an open tab keeps its old bundle until reloaded.
