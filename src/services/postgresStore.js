import { randomBytes, randomUUID } from "node:crypto";
import { getPool, closeDatabase } from "../config/database.js";

const sessionColumns = {
  status: "status",
  startedAt: "started_at",
  endedAt: "ended_at",
  score: "score",
  snakeLength: "snake_length",
  finalSnakeCells: "final_snake_cells",
  moves: "moves",
  deathReason: "death_reason",
  replayGifUrl: "replay_gif_url",
  mintPayloadHash: "mint_payload_hash",
  mintSignature: "mint_signature",
  snakeDataHash: "snake_data_hash",
  revealBlock: "reveal_block",
  random: "random",
  mintedTokenId: "minted_token_id",
  txHash: "tx_hash",
};

export async function upsertUser(walletAddress) {
  const timestamp = now();
  const result = await getPool().query(
    `INSERT INTO users (
       id, wallet_address, registered_at, has_minted, created_at, updated_at
     )
     VALUES ($1, $2, $3, FALSE, $3, $3)
     ON CONFLICT (wallet_address)
     DO UPDATE SET updated_at = users.updated_at
     RETURNING *`,
    [randomUUID(), walletAddress, timestamp],
  );
  return mapUser(result.rows[0]);
}

export async function findUser(walletAddress) {
  const result = await getPool().query(
    "SELECT * FROM users WHERE wallet_address = $1",
    [walletAddress],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function createInviteCodes({ count, createdBy }) {
  if (count <= 0) return [];

  const timestamp = now();
  const values = [];
  const placeholders = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`,
    );
    values.push(randomUUID(), makeInviteCode(), createdBy, timestamp);
  }

  const result = await getPool().query(
    `INSERT INTO invite_codes (id, code, created_by, created_at)
     VALUES ${placeholders.join(", ")}
     RETURNING *`,
    values,
  );
  return result.rows.map(mapInvite);
}

export async function clearInviteCodes() {
  await getPool().query("DELETE FROM invite_codes");
  return [];
}

export async function listInviteCodes() {
  const result = await getPool().query(
    "SELECT * FROM invite_codes ORDER BY created_at DESC",
  );
  return result.rows.map(mapInvite);
}

export async function redeemInviteCode({ code, walletAddress }) {
  return withTransaction(async (client) => {
    const normalizedCode = normalizeCode(code);
    const result = await client.query(
      "SELECT * FROM invite_codes WHERE code = $1 FOR UPDATE",
      [normalizedCode],
    );
    const invite = result.rows[0];

    if (!invite) {
      throw storeError("INVITE_NOT_FOUND", "Invite code does not exist");
    }

    if (invite.redeemed_by && invite.redeemed_by !== walletAddress) {
      throw storeError("INVITE_USED", "Invite code has already been used");
    }

    if (!invite.redeemed_by) {
      const updated = await client.query(
        `UPDATE invite_codes
         SET redeemed_by = $1, redeemed_at = $2
         WHERE id = $3
         RETURNING *`,
        [walletAddress, now(), invite.id],
      );
      return mapInvite(updated.rows[0]);
    }

    return mapInvite(invite);
  });
}

// A redeemed code stays valid for the wallet across all of its mint chances
// (one code, three chances). The per-wallet mint cap is the real limiter, so we
// no longer drop the invite once it has been used for a first mint.
export async function findInviteByWallet(walletAddress) {
  const result = await getPool().query(
    `SELECT *
     FROM invite_codes
     WHERE redeemed_by = $1
     ORDER BY redeemed_at ASC
     LIMIT 1`,
    [walletAddress],
  );
  return result.rows[0] ? mapInvite(result.rows[0]) : null;
}

export async function listAllowlist() {
  const result = await getPool().query(
    "SELECT * FROM allowlist ORDER BY added_at DESC",
  );
  return result.rows.map(mapAllowlist);
}

export async function addAllowlistWallets({ walletAddresses, addedBy }) {
  if (walletAddresses.length === 0) return [];

  const timestamp = now();
  const values = [];
  const placeholders = [];

  walletAddresses.forEach((walletAddress, index) => {
    const offset = index * 4;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`,
    );
    values.push(randomUUID(), walletAddress, addedBy, timestamp);
  });

  const result = await getPool().query(
    `INSERT INTO allowlist (id, wallet_address, added_by, added_at)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (wallet_address) DO NOTHING
     RETURNING *`,
    values,
  );
  return result.rows.map(mapAllowlist);
}

export async function removeAllowlistWallet(walletAddress) {
  const result = await getPool().query(
    "DELETE FROM allowlist WHERE wallet_address = $1",
    [walletAddress],
  );
  return result.rowCount > 0;
}

export async function clearAllowlist() {
  await getPool().query("DELETE FROM allowlist");
  return [];
}

export async function isWalletAllowlisted(walletAddress) {
  const result = await getPool().query(
    "SELECT EXISTS (SELECT 1 FROM allowlist WHERE wallet_address = $1) AS exists",
    [walletAddress],
  );
  return result.rows[0].exists;
}

export async function getSettings() {
  const result = await getPool().query(
    "SELECT invite_required FROM app_settings WHERE id = 1",
  );
  return {
    inviteRequired: result.rows[0]?.invite_required ?? true,
  };
}

export async function updateSettings(data) {
  const current = await getSettings();
  const inviteRequired =
    typeof data.inviteRequired === "boolean"
      ? data.inviteRequired
      : current.inviteRequired;

  const result = await getPool().query(
    `INSERT INTO app_settings (id, invite_required, updated_at)
     VALUES (1, $1, $2)
     ON CONFLICT (id)
     DO UPDATE SET invite_required = EXCLUDED.invite_required,
                   updated_at = EXCLUDED.updated_at
     RETURNING invite_required`,
    [inviteRequired, now()],
  );
  return { inviteRequired: result.rows[0].invite_required };
}

export async function markInviteMinted({ walletAddress }) {
  const result = await getPool().query(
    `WITH selected AS (
       SELECT id
       FROM invite_codes
       WHERE redeemed_by = $1 AND minted_at IS NULL
       ORDER BY redeemed_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE invite_codes
     SET minted_by = $1, minted_at = $2
     WHERE id = (SELECT id FROM selected)
     RETURNING *`,
    [walletAddress, now()],
  );
  return result.rows[0] ? mapInvite(result.rows[0]) : null;
}

export async function findSessionsByWallet(walletAddress) {
  const result = await getPool().query(
    `SELECT *
     FROM game_sessions
     WHERE wallet_address = $1
     ORDER BY created_at DESC`,
    [walletAddress],
  );
  return result.rows.map(mapSession);
}

export async function findSessionById(id) {
  const result = await getPool().query(
    "SELECT * FROM game_sessions WHERE id = $1",
    [id],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

// Admin maintenance: expire a wallet's locked-but-unminted runs (ACTIVE or
// COMPLETED) so the "one pending run per wallet" rule lets it play again — e.g.
// after a game-signer change or an expired commit-reveal block leaves a run
// unmintable. Returns how many sessions were expired.
export async function expirePendingSessions(walletAddress, { maxRevealBlock } = {}) {
  const result = await getPool().query(
    `UPDATE game_sessions
     SET status = 'EXPIRED', updated_at = $2
     WHERE wallet_address = $1
       AND status = 'COMPLETED'
       AND minted_token_id IS NULL
       AND reveal_block IS NOT NULL
       AND ($3::bigint IS NULL OR reveal_block <= $3)`,
    [walletAddress, now(), maxRevealBlock ?? null],
  );
  return result.rowCount;
}

// Single round-trip start. The partial unique index
// game_sessions_one_pending_per_wallet_idx guarantees at most one
// ACTIVE/COMPLETED session per wallet, so eligibility and the insert can run in
// one statement with no transaction and no advisory lock — that hold time per
// connection was the throughput ceiling under burst load. The happy path is one
// query; only a rare lost insert race needs a single follow-up read.
export async function prepareGameStart(walletAddress, { maxMintsPerWallet }) {
  const result = await getPool().query(
    `WITH summary AS (
       SELECT
         EXISTS(SELECT 1 FROM users WHERE wallet_address = $2) AS user_exists,
         EXISTS(SELECT 1 FROM invite_codes WHERE redeemed_by = $2) AS has_invite,
         EXISTS(SELECT 1 FROM allowlist WHERE wallet_address = $2) AS is_allowlisted,
         COALESCE((SELECT invite_required FROM app_settings WHERE id = 1), TRUE) AS invite_required,
         (SELECT COUNT(*)::int FROM game_sessions
            WHERE wallet_address = $2 AND status = 'MINTED') AS minted_count
     ),
     ins AS (
       INSERT INTO game_sessions (
         id, wallet_address, status, started_at, created_at, updated_at
       )
       SELECT $1, $2, 'ACTIVE', $3, $3, $3
       FROM summary
       WHERE summary.user_exists
         AND (NOT summary.invite_required OR summary.has_invite OR summary.is_allowlisted)
         AND summary.minted_count < $4
       ON CONFLICT (wallet_address) WHERE status IN ('ACTIVE', 'COMPLETED')
       DO NOTHING
       RETURNING *
     )
     SELECT
       summary.user_exists,
       summary.has_invite,
       summary.is_allowlisted,
       summary.invite_required,
       summary.minted_count,
       (SELECT row_to_json(ins) FROM ins) AS inserted,
       (SELECT row_to_json(live)
          FROM (
            SELECT *
            FROM game_sessions
            WHERE wallet_address = $2 AND status IN ('ACTIVE', 'COMPLETED')
            ORDER BY created_at DESC
            LIMIT 1
          ) live) AS existing
     FROM summary`,
    [randomUUID(), walletAddress, now(), maxMintsPerWallet],
  );

  const row = result.rows[0];
  const eligible =
    row.user_exists &&
    (!row.invite_required || row.has_invite || row.is_allowlisted) &&
    row.minted_count < maxMintsPerWallet;

  let session = row.inserted
    ? mapSession(row.inserted)
    : row.existing
      ? mapSession(row.existing)
      : null;

  // Extremely rare: we were eligible but lost the insert race to a concurrent
  // start whose commit postdated our snapshot, so `existing` came back null. One
  // direct read resolves it to the winning ACTIVE session.
  if (!session && eligible) {
    const live = await getPool().query(
      `SELECT *
       FROM game_sessions
       WHERE wallet_address = $1 AND status IN ('ACTIVE', 'COMPLETED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [walletAddress],
    );
    session = live.rows[0] ? mapSession(live.rows[0]) : null;
  }

  return {
    userExists: row.user_exists,
    inviteRequired: row.invite_required,
    hasInvite: row.has_invite,
    isAllowlisted: row.is_allowlisted,
    mintedCount: row.minted_count,
    session,
  };
}

export async function createSession(walletAddress) {
  return withTransaction(async (client) => {
    await lockWallet(client, walletAddress);

    const existing = await client.query(
      `SELECT *
       FROM game_sessions
       WHERE wallet_address = $1 AND status IN ('ACTIVE', 'COMPLETED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [walletAddress],
    );

    if (existing.rows[0]?.status === "ACTIVE") {
      return mapSession(existing.rows[0]);
    }

    if (existing.rows[0]) {
      throw storeError(
        "PENDING_SESSION",
        "Wallet has a locked game result waiting to be minted",
      );
    }

    const timestamp = now();
    const result = await client.query(
      `INSERT INTO game_sessions (
         id, wallet_address, status, started_at, created_at, updated_at
       )
       VALUES ($1, $2, 'ACTIVE', $3, $3, $3)
       RETURNING *`,
      [randomUUID(), walletAddress, timestamp],
    );
    return mapSession(result.rows[0]);
  });
}

export async function updateSession(id, data) {
  const entries = Object.entries(data).filter(([key]) => sessionColumns[key]);
  if (entries.length === 0) return findSessionById(id);

  const assignments = [];
  const values = [];

  entries.forEach(([key, value], index) => {
    assignments.push(`${sessionColumns[key]} = $${index + 1}`);
    values.push(value);
  });

  values.push(now(), id);
  const result = await getPool().query(
    `UPDATE game_sessions
     SET ${assignments.join(", ")}, updated_at = $${values.length - 1}
     WHERE id = $${values.length}
     RETURNING *`,
    values,
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function createMintRecord({
  walletAddress,
  sessionId,
  tokenId,
  txHash,
  consumeInvite = true,
}) {
  return withTransaction(async (client) => {
    await lockWallet(client, walletAddress);

    const sessionResult = await client.query(
      "SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    const session = sessionResult.rows[0];

    if (!session || session.wallet_address !== walletAddress) {
      throw storeError("SESSION_NOT_FOUND", "Game session not found");
    }

    if (session.status !== "COMPLETED") {
      throw storeError(
        "DUPLICATE_SESSION",
        "Session has already been recorded as minted",
      );
    }

    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM mint_records WHERE wallet_address = $1",
      [walletAddress],
    );
    if (countResult.rows[0].count >= 3) {
      throw storeError("WALLET_LIMIT", "Wallet mint limit reached");
    }

    const timestamp = now();
    let record;
    try {
      const result = await client.query(
        `INSERT INTO mint_records (
           id, wallet_address, token_id, session_id, tx_hash, minted_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [randomUUID(), walletAddress, tokenId, sessionId, txHash, timestamp],
      );
      record = result.rows[0];
    } catch (error) {
      if (error.code === "23505") {
        const isSession = error.constraint?.includes("session");
        throw storeError(
          isSession ? "DUPLICATE_SESSION" : "DUPLICATE_TX",
          isSession
            ? "Session has already been recorded as minted"
            : "Transaction hash has already been recorded",
        );
      }
      throw error;
    }

    await client.query(
      `UPDATE users
       SET has_minted = TRUE, updated_at = $1
       WHERE wallet_address = $2`,
      [timestamp, walletAddress],
    );

    await client.query(
      `UPDATE game_sessions
       SET status = 'MINTED',
           minted_token_id = $1,
           tx_hash = $2,
           updated_at = $3
       WHERE id = $4`,
      [tokenId, txHash, timestamp, sessionId],
    );

    if (consumeInvite) {
      await client.query(
        `WITH selected AS (
           SELECT id
           FROM invite_codes
           WHERE redeemed_by = $1 AND minted_at IS NULL
           ORDER BY redeemed_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE invite_codes
         SET minted_by = $1, minted_at = $2
         WHERE id = (SELECT id FROM selected)`,
        [walletAddress, timestamp],
      );
    }

    return mapMintRecord(record);
  });
}

export async function checkStoreHealth() {
  await getPool().query("SELECT 1");
  return true;
}

export async function closeStore() {
  await closeDatabase();
}

async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockWallet(client, walletAddress) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    walletAddress,
  ]);
}

function mapUser(row) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    registeredAt: toIso(row.registered_at),
    hasMinted: row.has_minted,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapInvite(row) {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    redeemedBy: row.redeemed_by,
    redeemedAt: toIso(row.redeemed_at),
    mintedBy: row.minted_by,
    mintedAt: toIso(row.minted_at),
  };
}

function mapAllowlist(row) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    addedBy: row.added_by,
    addedAt: toIso(row.added_at),
  };
}

function mapSession(row) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    status: row.status,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    score: row.score,
    snakeLength: row.snake_length,
    finalSnakeCells: row.final_snake_cells,
    moves: row.moves,
    deathReason: row.death_reason,
    replayGifUrl: row.replay_gif_url,
    mintPayloadHash: row.mint_payload_hash,
    mintSignature: row.mint_signature,
    snakeDataHash: row.snake_data_hash,
    revealBlock:
      row.reveal_block === null || row.reveal_block === undefined
        ? null
        : Number(row.reveal_block),
    random: row.random ?? false,
    mintedTokenId: row.minted_token_id,
    txHash: row.tx_hash,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapMintRecord(row) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    tokenId: row.token_id,
    sessionId: row.session_id,
    txHash: row.tx_hash,
    mintedAt: toIso(row.minted_at),
  };
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function now() {
  return new Date().toISOString();
}

function normalizeCode(code) {
  return String(code).trim().toUpperCase();
}

function makeInviteCode() {
  return `SNX-${randomBytes(3).toString("hex").toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
