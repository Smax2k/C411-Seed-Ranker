CREATE TABLE IF NOT EXISTS radar_family_stats (
  user_id TEXT NOT NULL DEFAULT '',
  scope_key TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  label TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active_days TEXT NOT NULL DEFAULT '[]',
  active_day_count INTEGER NOT NULL DEFAULT 0,
  seen_torrents TEXT NOT NULL DEFAULT '[]',
  torrent_count INTEGER NOT NULL DEFAULT 0,
  appearance_count INTEGER NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  max_leechers INTEGER NOT NULL DEFAULT 0,
  max_seeders INTEGER NOT NULL DEFAULT 0,
  latest_title TEXT NOT NULL DEFAULT '',
  latest_torrents TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope_key, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_radar_family_stats_user_last_seen
  ON radar_family_stats(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_radar_family_stats_user_heat
  ON radar_family_stats(user_id, max_score DESC, torrent_count DESC, active_day_count DESC);
