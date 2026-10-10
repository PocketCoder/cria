-- Add is_favorite column to projects (Vikunja API supports it).
-- The server may also return a virtual "Favorites" parent project when
-- projects are favorited — storing the flag lets us filter/display it.

ALTER TABLE projects ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
