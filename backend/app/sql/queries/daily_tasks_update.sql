UPDATE daily_tasks
SET name = $2, color = $3, active = $4, days_mask = $5
WHERE id = $1
RETURNING id, name, color, position, active, days_mask;
