-- Moving a task to another day drops it at the top of that day, the same place
-- a brand new task would land; staying put keeps the position it was dragged
-- to. Both sides of the CASE read the pre-update snapshot, so `due_date` is the
-- old value and the subquery cannot see this row under its new date.
UPDATE tasks
SET description = $2,
    notes       = $3,
    category_id = $4,
    due_date    = $5,
    done        = $6,
    position    = CASE
                    WHEN due_date = $5 THEN position
                    ELSE (SELECT COALESCE(MIN(position), 0) - 1
                          FROM tasks WHERE due_date = $5)
                  END,
    updated_at  = now()
WHERE id = $1
RETURNING id, description, notes, category_id, project_id, due_date, done, position;
