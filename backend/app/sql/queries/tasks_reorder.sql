-- Rewrites one day's ordering in a single statement: the ids arrive already in
-- the order they should appear and WITH ORDINALITY turns that array order into
-- the stored position, normalising the day to 0..n-1.
--
-- The due_date guard is what makes this safe to hand a client-built list: ids
-- belonging to another day (or to no task at all) match nothing and are
-- silently skipped, so a stale tab can only ever renumber the day it was
-- actually looking at.
UPDATE tasks t
SET position   = o.pos - 1,
    updated_at = now()
FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos)
WHERE t.id = o.id AND t.due_date = $1;
