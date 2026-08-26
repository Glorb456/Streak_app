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
