CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  registered_at TIMESTAMPTZ NOT NULL,
  has_minted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  redeemed_by TEXT,
  redeemed_at TIMESTAMPTZ,
  minted_by TEXT,
  minted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invite_codes_redeemed_by_idx
  ON invite_codes (redeemed_by)
  WHERE redeemed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS invite_codes_available_wallet_idx
  ON invite_codes (redeemed_by, minted_at)
  WHERE redeemed_by IS NOT NULL AND minted_at IS NULL;

CREATE TABLE IF NOT EXISTS allowlist (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_flags (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  reason TEXT,
  flag_count INTEGER NOT NULL DEFAULT 1,
  flagged_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  invite_required BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id, invite_required)
VALUES (1, TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  score INTEGER,
  snake_length INTEGER,
  final_snake_cells TEXT,
  moves TEXT,
  death_reason TEXT,
  replay_gif_url TEXT,
  mint_payload_hash TEXT,
  mint_signature TEXT,
  snake_data_hash TEXT,
  reveal_block BIGINT,
  random BOOLEAN NOT NULL DEFAULT FALSE,
  minted_token_id TEXT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Migrations for existing deployments (no-ops on fresh installs).
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS snake_data_hash TEXT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS reveal_block BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS random BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS game_sessions_wallet_created_idx
  ON game_sessions (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS game_sessions_wallet_status_idx
  ON game_sessions (wallet_address, status);

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_one_pending_per_wallet_idx
  ON game_sessions (wallet_address)
  WHERE status IN ('ACTIVE', 'COMPLETED');

CREATE TABLE IF NOT EXISTS mint_records (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES game_sessions(id),
  tx_hash TEXT NOT NULL UNIQUE,
  minted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS mint_records_wallet_idx
  ON mint_records (wallet_address, minted_at DESC);
