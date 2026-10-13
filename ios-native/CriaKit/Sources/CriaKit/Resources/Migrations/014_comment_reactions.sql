-- ---------------------------------------------------------------------------
-- 014: comment reactions
-- Stores the ReactionMap (emoji -> user[]) as a JSON blob so reactions
-- survive app restarts and are refreshed from the server on each pull.
-- ---------------------------------------------------------------------------

ALTER TABLE task_comments ADD COLUMN reactions TEXT;
