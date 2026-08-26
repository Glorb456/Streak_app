-- Only completions of still-active daily tasks; soft-deleted tasks leave
-- rows behind that the UI never shows.
SELECT c.daily_task_id, c.day, c.completed
FROM daily_task_completions c
JOIN daily_tasks d ON d.id = c.daily_task_id
WHERE d.active AND c.day BETWEEN $1 AND $2;
