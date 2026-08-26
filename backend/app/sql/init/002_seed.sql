-- Runs on every startup; the 'seeded' settings flag makes it a one-time seed
-- (names are no longer unique, so ON CONFLICT can't be used for idempotency).
INSERT INTO categories (name, color, position)
SELECT * FROM (VALUES
    ('Math',     '#4caf50', 0),
    ('History',  '#42a5f5', 1),
    ('Science',  '#3f51b5', 2),
    ('Gym',      '#ab47bc', 3),
    ('Personal', '#8e1c1c', 4)
) AS v(name, color, position)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT INTO daily_tasks (name, color, position)
SELECT * FROM (VALUES
    ('Exercise',    '#cde8d0', 0),
    ('Read 30 min', '#cfe3f7', 1)
) AS v(name, color, position)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT INTO settings (key, value) VALUES
    ('background_color', '#191919'),
    ('seeded', '1')
ON CONFLICT (key) DO NOTHING;
