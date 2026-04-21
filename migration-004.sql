-- migration-004: Auth tables (users, sessions, magic_links)

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK(role IN ('superuser','admin','district_manager','manager')),
  stores     TEXT,        -- JSON array e.g. '["BL1","BL4"]'; NULL = all stores
  status     TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,  -- 32-byte random hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,  -- 32-byte random hex
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT               -- NULL = unused
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
