-- position ascending inside a day, id as the tiebreaker so rows created before
-- the position column existed (all of them at 0) keep their creation order.
SELECT id, description, notes, category_id, project_id, due_date, done, position
FROM tasks
WHERE due_date BETWEEN $1 AND $2
ORDER BY due_date, position, id;
