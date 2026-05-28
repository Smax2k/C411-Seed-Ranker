ALTER TABLE torrent_cache ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_torrent_cache_user_torrent
  ON torrent_cache(user_id, torrent_key);

CREATE INDEX IF NOT EXISTS idx_torrent_cache_user_scope_seen
  ON torrent_cache(user_id, scope_key, last_seen_at DESC);
