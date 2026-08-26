-- Per-day count of completed daily tasks that were actually scheduled on that
-- day (days_mask bit 0 = Monday ... bit 6 = Sunday; ISODOW is 1=Mon..7=Sun).
-- Off-schedule completions are excluded: the streak endpoint only compares
-- counts, so one would otherwise stand in for a task that really was due.
-- EXTRACT returns numeric on PG14+, and >> is not defined for numeric.
SELECT c.day, COUNT(*) AS done
FROM daily_task_completions c
JOIN daily_tasks d ON d.id = c.daily_task_id AND d.active
WHERE c.completed
  AND c.day BETWEEN $1 AND $2
  AND ((d.days_mask >> (EXTRACT(ISODOW FROM c.day)::int - 1)) & 1) = 1
GROUP BY c.day;
