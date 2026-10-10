-- ---------------------------------------------------------------------------
-- 018: saved filters
-- Mirrors Vikunja's saved filters (global per-user, exposed by the server as
-- negative-id pseudo-projects in GET /projects; the query payload comes from
-- GET /filters/{id}). Navigation uses the pseudo-project row in `projects`;
-- this table holds the filter query itself.
-- No dirty/conflict columns: the server is the only writer besides
-- direct-API CRUD, which upserts here immediately after the call.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_filters (
    server_id            INTEGER PRIMARY KEY,   -- Vikunja filter id (positive)
    title                TEXT NOT NULL,
    description          TEXT,
    filter_query         TEXT NOT NULL,          -- Vikunja filter DSL string
    filter_include_nulls INTEGER NOT NULL DEFAULT 0,
    updated_at           TEXT
);
