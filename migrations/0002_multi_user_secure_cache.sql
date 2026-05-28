CREATE TABLE IF NOT EXISTS rss_users (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

UPDATE torrent_cache
SET
  link = '',
  raw_json = json_remove(raw_json, '$.link', '$.guid')
WHERE link LIKE '%apikey=%'
   OR raw_json LIKE '%apikey=%';
