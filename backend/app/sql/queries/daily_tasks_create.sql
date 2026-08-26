INSERT INTO daily_tasks (name, color, days_mask, position)
VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) + 1 FROM daily_tasks), 0))
RETURNING id, name, color, position, active, days_mask;
