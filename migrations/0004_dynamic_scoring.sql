CREATE TABLE IF NOT EXISTS torrent_score_snapshots (
  user_id TEXT NOT NULL DEFAULT '',
  scope_key TEXT NOT NULL,
  torrent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  guid TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  seeders INTEGER NOT NULL DEFAULT 0,
  leechers INTEGER NOT NULL DEFAULT 0,
  grabs INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope_key, torrent_key, seen_at)
);

CREATE INDEX IF NOT EXISTS idx_torrent_score_snapshots_recent
  ON torrent_score_snapshots(user_id, scope_key, seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_torrent_score_snapshots_torrent
  ON torrent_score_snapshots(user_id, torrent_key, seen_at DESC);

CREATE TABLE IF NOT EXISTS rss_score_hits (
  user_id TEXT NOT NULL DEFAULT '',
  scope_key TEXT NOT NULL,
  torrent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  guid TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  seeders INTEGER NOT NULL DEFAULT 0,
  leechers INTEGER NOT NULL DEFAULT 0,
  grabs INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  hit_at INTEGER NOT NULL,
  keep_until INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope_key, torrent_key)
);

CREATE INDEX IF NOT EXISTS idx_rss_score_hits_keep
  ON rss_score_hits(user_id, scope_key, keep_until DESC);
