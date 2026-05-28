CREATE TABLE IF NOT EXISTS torrent_scan_states (
  scope_key TEXT PRIMARY KEY,
  query TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '',
  scanned_at INTEGER NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  target_scan INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS torrent_cache (
  scope_key TEXT NOT NULL,
  torrent_key TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  guid TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  seeders INTEGER NOT NULL DEFAULT 0,
  leechers INTEGER NOT NULL DEFAULT 0,
  grabs INTEGER NOT NULL DEFAULT 0,
  infohash TEXT NOT NULL DEFAULT '',
  upload_volume_factor REAL NOT NULL DEFAULT 1,
  download_volume_factor REAL NOT NULL DEFAULT 1,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (scope_key, torrent_key)
);

CREATE INDEX IF NOT EXISTS idx_torrent_cache_scope_seen
  ON torrent_cache(scope_key, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_torrent_cache_scope_filters
  ON torrent_cache(scope_key, seeders, leechers, size_bytes, pub_date);
