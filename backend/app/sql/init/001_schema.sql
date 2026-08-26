CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#7a7a7a',
    position    INT  NOT NULL DEFAULT 0
);

-- Future feature: projects group multiple tasks under one category.
CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    id          SERIAL PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    project_id  INT REFERENCES projects(id) ON DELETE SET NULL,
    due_date    DATE NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);

-- Manual ordering within a day, ascending. Rows predating this column all sit
-- at 0 and fall back to the id tiebreaker in tasks_list_range, so every
-- existing day keeps exactly the order it had. New tasks go *above* everything
-- else by taking MIN(position) - 1 (see tasks_create.sql) rather than renumbering
-- the day, which is why this is a signed INT and not a 0..n counter -- a day
-- that has never been dragged drifts negative and that is fine. Only
-- tasks_reorder normalises a day back to 0..n-1.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS daily_tasks (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#f9e2ce',
    position    INT  NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Names are not unique: deletes are soft (active = FALSE), so old names may
-- linger invisibly and must not block new tasks. Drops the constraint on
-- databases created before this change.
ALTER TABLE categories  DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_name_key;

-- Weekday schedule bitmask: bit 0 = Monday ... bit 6 = Sunday, matching the
-- Monday-first week the UI uses and Python's date.weekday(). 127 = every day,
-- i.e. the behaviour before this column existed, so rows predating it are
-- unchanged. A mask of 0 parks a task: it is due on no day at all.
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS days_mask INT NOT NULL DEFAULT 127;

CREATE TABLE IF NOT EXISTS daily_task_completions (
    daily_task_id INT  NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
    day           DATE NOT NULL,
    completed     BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (daily_task_id, day)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
