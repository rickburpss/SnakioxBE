# 🧠 Memory Log
> Append-only. Never delete or edit previous entries.
> Initialized: 2026-06-25

---

## [2026-06-25] — Mint signing rework: hash-only, commit-reveal block, random mint, replay serving

### Project Status & Decisions
- Backend updated alongside the Snakiox contract (`../SnakioxDOTSOL`) and frontend (`../SnakioxFE`). ESM Express; storage driver `json` (default, `.data/snakiox.json`) or `postgres`. The backend **signs mint authorizations** with `GAME_SIGNER_PRIVATE_KEY`; it never sends transactions.
- The mint signature now binds: `wallet, sessionHash, snakeDataHash, score, snakeLength, random, revealBlock, contract, chainId`. The raw replay blob is **no longer sent** to the chain — only its hash.

### What was added/changed (by file)
- **`src/services/signatureService.js`**
  - `buildMintPayload` signs the **hash** of the replay (not the blob); types/values now include `bool random` and `uint256 revealBlock`. For random mints `snakeDataHash = id("random:"+sessionId)` (sentinel — there is no replay). Returns `random` + `revealBlock` in the payload.
- **`src/services/chainService.js`** (NEW)
  - Read-only `JsonRpcProvider` (from `RPC_URL`). `pickRevealBlock()` = `currentBlock + REVEAL_BUFFER_BLOCKS` — the future block whose hash the contract uses for traits/rarity (commit-reveal; unknowable when signed → grind-proof). Warns + returns 0 if `RPC_URL` unset (mints then fail safely).
- **`src/config/env.js`**
  - Added `rpcUrl` (`RPC_URL`), `revealBufferBlocks` (`REVEAL_BUFFER_BLOCKS`, default 2). `maxGameDurationSeconds` default 7200 → **2700 (45 min)** to match the FE's 40-min auto-end with margin.
- **`src/services/gameService.js`**
  - `completeGame` now persists `snakeDataHash`, `revealBlock`, `random:false` on the session (so a reload can still mint), and fetches `revealBlock` via `pickRevealBlock()`.
  - **`generateRandomResult(wallet)`** (NEW): the "random score" mint. Validates eligibility (registered, invite/allowlist, under mint cap) + **no existing ACTIVE/COMPLETED session**, generates a random score (0–2000) and length (6–60), signs with `random:true` + a reveal block, and creates a **COMPLETED (locked)** session. The one-pending-per-wallet rule then blocks playing/re-rolling → "bound for life, must mint".
  - `getReplayBySession` now **refuses random sessions** ("Random-score mints have no replay").
- **`src/routes/game.js`**
  - **`POST /game/random`** → `generateRandomResult`. `serializeResultResponse` now includes `snakeDataHash`/`revealBlock`/`random` so the FE can mint a reloaded result.
- **`src/routes/replay.js`** — `GET /replay/:sessionId` serves a locked run's stored replay (`finalSnakeCells`/`moves`); this is the free "store on backend" option (no IPFS yet).
- **Stores**: `jsonStore` is schemaless (defaults added for the new fields, `Object.assign` update). `postgresStore` got `snakeDataHash`/`revealBlock`/`random` in `sessionColumns` + `mapSession`. `db/schema.sql` adds `snake_data_hash TEXT`, `reveal_block BIGINT`, `random BOOLEAN` to `game_sessions` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations.

### Problems Solved / Lessons Learned
- Anti-gaming for random mints lives here, not in the contract: the existing **one-pending-session-per-wallet** rule (startGame check + Postgres unique partial index) is what prevents re-rolling and forces "must mint". The contract only enforces the signature, price, and replay-ban.
- Commit-reveal block is chosen at **complete/sign time** (not game start) so it fits inside the chain's 256-block (~50 min) hash window even for long games. Backend just needs the current block number → `RPC_URL`.
- Fields that are signed but not re-derivable by the FE (`revealBlock`, `random`, and the sentinel `snakeDataHash`) must be persisted and returned in the result API.

### Verified
- All changed files pass `node --check`. Logic mirrors existing patterns; not yet run as a live integration test (needs a running store + RPC).

### Goals & Next Steps
- Set `RPC_URL` (required for minting) + `MINT_CONTRACT_ADDRESS` to the redeployed contract; optional `REVEAL_BUFFER_BLOCKS`.
- For existing Postgres DBs, apply the `ALTER TABLE` migrations in `db/schema.sql`.
- Optional: a local integration test that spins up the json store and exercises `/game/random` end-to-end.

---

## [2026-06-26] — Supabase migration, Prisma sync, admin page redesign (FE)

### Project Status & Decisions
- Moved the backend onto **Supabase Postgres**. The `.env` already held the pooler URLs; the real blocker was SSL — `database.js` only enabled TLS in production, so dev connections to Supabase failed. Now SSL is on for any non-local host. Verified live with `npm run db:init` ("schema is ready").
- **Decision (user):** keep the raw `pg` data layer (postgresStore.js); do NOT rewrite to Prisma Client. Prisma is the schema/migration source of truth only.

### Tech Stack & Tools
- BE: Express + raw `pg`, Prisma 5.22 (schema/migrations only), Supabase (transaction pooler :6543 for app, session pooler :5432 as DIRECT_URL).
- FE: React 18 + Vite 5 + Tailwind + lucide-react. Admin routing is client-side via pushState/popstate (no react-router).

### What was added/changed (by file)
- **`src/config/database.js`** — SSL now enabled for any non-local DB host regardless of NODE_ENV (Supabase pooler requires TLS). Was the cause of dev connect failures.
- **`src/server.js`** — added `unhandledRejection` (log, keep serving) + `uncaughtException` (drain + clean shutdown) handlers so a transient DB blip cannot kill the process under traffic.
- **`prisma/schema.prisma`** — rewritten from stale sqlite/3-model to **postgresql + directUrl**, all 6 tables (users, invite_codes, allowlist, app_settings, game_sessions, mint_records) with snake_case @map, BigInt/SmallInt/Timestamptz types, indexes, and the mint_records→game_sessions FK. `prisma validate` + `generate` pass. Kept in sync with `db/schema.sql`.
- **`.env.example`** — documents Supabase DATABASE_URL + DIRECT_URL + STORAGE_DRIVER=postgres.
- **FE `src/App.jsx`** — AdminPage split into 3 client-routed views: `/sekioadmini` (overview: contract status + redesigned OWNER ACTIONS card grid), `/sekioadmini/allowlist`, `/sekioadmini/invites`. Shared tab nav + wallet-auth bar with connected badge. Added `extractWallets()` (regex `0x[a-f0-9]{40}`, case-insensitive dedup), CSV/TXT upload handler (ignores header + other columns), DEDUPE button, stats strip. AdminAction now takes hint/placeholder/danger.
- **FE `src/styles.css`** — new admin classes (.admin-nav/.admin-tab, .admin-authbar/.admin-badge, .admin-overview, .admin-actions-grid/.action-card, .csv-tools/.csv-stats/.csv-chip, .invite-state) + responsive breakpoints at 900px and 760px.

### Problems Solved / Lessons Learned
- [Supabase dev connect fails]: SSL was gated on NODE_ENV=production; managed Postgres needs TLS always for non-local hosts.
- [CSV "extract wallets only"]: regex-extracting 0x addresses naturally skips the header row and any extra columns — no CSV parser needed. Dedup both FE (Set) and BE (ON CONFLICT DO NOTHING).
- Backend already dedups allowlist via Set + `ON CONFLICT (wallet_address) DO NOTHING`, so re-uploads never error.

### Goals & Next Steps
- CORS: `.env` APP_ORIGIN is localhost:5173 but `vite dev` serves 127.0.0.1:5173 (different origin). If CORS errors appear, set APP_ORIGIN to include both.
- Deploy: new /sekioadmini sub-routes need SPA history fallback (static hosts need a rewrite-to-index.html rule; vite dev/preview already handle it).
- Verified: BE `npm run lint`, FE eslint clean, `vite build` all pass.

---
