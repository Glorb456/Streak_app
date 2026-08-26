INSERT INTO daily_task_completions (daily_task_id, day, completed)
VALUES ($1, $2, $3)
ON CONFLICT (daily_task_id, day) DO UPDATE SET completed = EXCLUDED.completed
RETURNING daily_task_id, day, completed;
