SELECT id, name, color, position, active, days_mask
FROM daily_tasks
WHERE active
ORDER BY position, id;
