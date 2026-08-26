-- Multi-node sync support (host / backup / buddy-mirror replicas).
--
-- Every replicated row gets a globally-unique `uid` (serial ids stay
-- node-local and are never exchanged) and an `updated_at` that last-writer-wins
-- merging compares. Deletes are remembered in sync_deletions so a delete on
-- one node doesn't resurrect on the next merge; merges where both sides
-- changed the same row since the last sync are logged to sync_conflicts for
-- the bare-bones resolver UI while the newer version wins immediately.
--
-- Adding a column with a volatile default (gen_random_uuid) rewrites the
-- table evaluating the default per row, so pre-existing rows each get their
-- own uid. That is fine: backup/mirror nodes start from an EMPTY database
-- (db.py skips the seed for them) and receive every row — uids included —
-- from the host, so uids agree across nodes by construction.

ALTER TABLE categories  ADD COLUMN IF NOT EXISTS uid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS uid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE tasks       ADD COLUMN IF NOT EXISTS uid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS uid UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_uid  ON categories (uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_uid    ON projects (uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uid       ON tasks (uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_tasks_uid ON daily_tasks (uid);

-- tasks already has updated_at; the rest gain one for LWW merging.
ALTER TABLE categories  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE settings    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE daily_task_completions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Keeps updated_at honest on every UPDATE without touching each query file.
-- The one exception is a sync import applying a peer's rows: it must preserve
-- the peer's timestamps or every merge would bump every row and the two nodes
-- would echo the same rows back and forth forever. The import runs inside a
-- transaction that sets the streak.sync flag (SET LOCAL), which this trigger
-- honours.
CREATE OR REPLACE FUNCTION sync_touch_updated_at() RETURNS trigger AS $$
BEGIN
    IF current_setting('streak.sync', true) IS DISTINCT FROM 'on' THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tombstones. Only categories, projects and tasks are ever hard-deleted by
-- the API (daily task deletes are soft, completions and settings are upserts),
-- but the trigger is attached to every uid-bearing table so a future delete
-- path is covered automatically. Recording is skipped under streak.sync: the
-- import code writes the peer's original deleted_at itself, which keeps a
-- deletion's timestamp stable as it travels between nodes.
CREATE TABLE IF NOT EXISTS sync_deletions (
    tbl        TEXT NOT NULL,
    uid        UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tbl, uid)
);

CREATE OR REPLACE FUNCTION sync_record_deletion() RETURNS trigger AS $$
BEGIN
    IF current_setting('streak.sync', true) IS DISTINCT FROM 'on' THEN
        INSERT INTO sync_deletions (tbl, uid, deleted_at)
        VALUES (TG_TABLE_NAME, OLD.uid, now())
        ON CONFLICT (tbl, uid) DO UPDATE SET deleted_at = now();
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Both sides of a merge changed the same row since the last sync: the newer
-- version has already won (the app keeps working), the loser is kept here so
-- the conflicts UI can restore it. Per-node bookkeeping; never synced.
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id          SERIAL PRIMARY KEY,
    tbl         TEXT NOT NULL,
    uid         TEXT NOT NULL,      -- uid, settings key, or "uid/day" for completions
    kept        JSONB NOT NULL,     -- the version now in the table
    lost        JSONB NOT NULL,     -- the version that lost the merge
    peer        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved    BOOLEAN NOT NULL DEFAULT FALSE
);

-- Engine bookkeeping: high-water marks per peer, one row per peer URL.
CREATE TABLE IF NOT EXISTS sync_peers (
    peer      TEXT PRIMARY KEY,
    last_pull TIMESTAMPTZ,
    last_push TIMESTAMPTZ
);

-- Triggers are dropped and re-created so this file stays idempotent across
-- restarts (CREATE TRIGGER has no IF NOT EXISTS on this Postgres major).
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['categories','projects','tasks','daily_tasks',
                             'daily_task_completions','settings'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION sync_touch_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['categories','projects','tasks','daily_tasks'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_record_deletion ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_record_deletion AFTER DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION sync_record_deletion()', t);
    END LOOP;
END $$;
