// Task ordering inside a day.
//
// The server stores an ascending `position` per day and the API already hands
// tasks back in that order, but the app also mutates `tasks` optimistically
// (a create appends, a reorder rewrites positions), so the order has to be
// re-derived on the client rather than trusted to arrival order.

// Ascending position within a day, id as the tiebreaker. The tiebreaker is
// what keeps databases predating the position column intact: every one of
// their rows sits at the 0 default, so they fall back to creation order.
// `?? 0` covers optimistic local objects that never round-tripped the server.
export function orderTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      a.id - b.id
  )
}

export function tasksOn(tasks, dayIso) {
  return orderTasks(tasks.filter((t) => t.due_date === dayIso))
}

// Move one item from index `from` to index `to`, returning a new array.
// Out-of-range indices leave the list alone rather than dropping or
// duplicating an entry — a drag that ends on nothing should be a no-op.
export function moveItem(list, from, to) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

// A drag only ever rearranges the rows the user can see, but `hide done` can
// be hiding finished tasks in among them and those must not be swept to one
// end. The visible ids are dealt back into the slots the visible tasks
// already occupied, in their new order; everything else keeps its slot.
//
// Returns the whole day's ids, which is what gets sent to the server — the
// endpoint renumbers a day wholesale, so a partial list would leave the
// hidden rows on stale positions that resurface when `hide done` goes off.
export function applyVisibleOrder(dayIds, visibleIds, newVisibleIds) {
  const visible = new Set(visibleIds)
  let n = 0
  return dayIds.map((id) => (visible.has(id) ? newVisibleIds[n++] ?? id : id))
}

// The id of the task at the top of `dayIso`, or null when that day is empty.
// Derived from the list being rendered rather than stored on the task, so it
// follows a drag, a delete or a new task with no extra bookkeeping — pass the
// same (already filtered) list the UI shows and the highlight can never point
// at a row that isn't there.
export function firstTaskIdOn(tasks, dayIso) {
  const day = tasksOn(tasks, dayIso)
  return day.length ? day[0].id : null
}
