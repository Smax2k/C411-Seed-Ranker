CREATE TABLE IF NOT EXISTS watchlist_rules (
  user_id TEXT NOT NULL DEFAULT '',
  pattern_key TEXT NOT NULL,
  label TEXT NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 650,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_rules_user_enabled
  ON watchlist_rules(user_id, enabled);
