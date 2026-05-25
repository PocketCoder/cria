-- Add extra task columns for favorites, subscription status.
-- These are scalar fields on the task model that round-trip through
-- the existing push/pull path.

ALTER TABLE tasks ADD COLUMN is_favorite  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN is_subscribed INTEGER NOT NULL DEFAULT 0;
