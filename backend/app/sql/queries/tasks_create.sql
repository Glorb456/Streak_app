-- New tasks land at the top of their day. Taking one below the day's current
-- minimum puts the row first without having to renumber -- and therefore
-- without a second statement that could half-apply.
INSERT INTO tasks (description, notes, category_id, due_date, position)
VALUES ($1, $2, $3, $4,
        (SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE due_date = $4))
RETURNING id, description, notes, category_id, project_id, due_date, done, position;
