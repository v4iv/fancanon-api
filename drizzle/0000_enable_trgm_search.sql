CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS story_title_trgm_idx
  ON story USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS story_description_trgm_idx
  ON story USING gin (coalesce(description, '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tag_name_trgm_idx
  ON tag USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS user_username_trgm_idx
  ON "user" USING gin (coalesce(username, '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS user_name_trgm_idx
  ON "user" USING gin (coalesce(name, '') gin_trgm_ops);
