-- Tick a brand-new daily task off on every day it would have been due before
-- it existed, so adding a habit today does not wipe out a running streak: the
-- streak endpoint judges a past day against the schedules as they stand *now*,
-- and without this the new task would count as missed on every one of them.
--
-- The mask is read from the row rather than passed in, so it cannot disagree
-- with the task that was just inserted. Days the task is not scheduled on are
-- skipped: daily_streak_counts ignores off-schedule completions anyway, so a
-- row there would buy nothing and only muddy the history.
-- ISODOW is 1=Mon..7=Sun against bit 0 = Monday; EXTRACT returns numeric on
-- PG14+ and >> is not defined for numeric, hence the ::int.
--
-- ON CONFLICT is defensive only -- $1 is a freshly minted id, so nothing can
-- already be there -- but it keeps the statement safe to replay.
INSERT INTO daily_task_completions (daily_task_id, day, completed)
SELECT t.id, d::date, TRUE
FROM daily_tasks t
CROSS JOIN generate_series($2::date, $3::date, INTERVAL '1 day') AS d
WHERE t.id = $1
  AND ((t.days_mask >> (EXTRACT(ISODOW FROM d)::int - 1)) & 1) = 1
ON CONFLICT (daily_task_id, day) DO NOTHING;
