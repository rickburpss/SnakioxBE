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

## [2026-06-27] — Clear DB, fix mint slowness (commit-reveal wait), surface fast-path

### Project Status & Decisions
- Cleared all Supabase data on request (TRUNCATE users/game_sessions/mint_records/invite_codes/allowlist + re-seed app_settings). Verified 0 rows. Reusable one-liner given to user.
- **Root cause of "minting takes forever / too long to sign":** the commit-reveal block wait, NOT the DB/RPC. Contract (Snakiox.sol:166) reverts RevealNotReady() unless block.number > revealBlock; FE waited for that future block BEFORE opening the wallet, showing a frozen "Minting...". Worst on the random->instant-mint path (sign+mint back-to-back). A normal played run usually has revealBlock already mined by mint time => no wait.
- **Decision (user):** reveal buffer 2 -> 1 block (smallest grind-proof value) + live feedback. Tiny reorg risk accepted on Sepolia.
- **Decision (user):** add a read-only "instant mint ready / reveal in ~Xs" badge (fast-path surfaced), behind a hide flag.

### What changed (by file)
- **BE `src/config/env.js`** — `revealBufferBlocks` default 2 -> 1 (env REVEAL_BUFFER_BLOCKS). Halves random-mint wait (~12s typical).
- **FE `src/web3/mintContract.js`** —
  - `mintCompletedRun(payload, onStatus)` now takes a status callback; reads price AND waits for reveal block CONCURRENTLY (Promise.all); emits stages: Waiting for reveal block / Confirm in wallet / Confirming on-chain.
  - `waitForBlock` short-circuits instantly when revealBlock already mined (the played-run fast-path); polls 2.5s with live countdown.
  - NEW `getRevealStatus(revealBlock)` — read-only {ready, blocksRemaining, secondsRemaining}; no chain switch, no signing.
  - `ensureChain` now checks cached eth_chainId first and SKIPS wallet_switchEthereumChain when already on-chain (was firing before every read => latency; fixes "slow just to show wallet" + post-mint lag).
- **FE `src/App.jsx`** — `mintFromPayload` wires onStatus into the loading label. ResultPanel polls getRevealStatus (only while a mintable run is pending & not ready, every 6s) and shows `.reveal-badge` ("Instant mint ready" / "Reveal locks in ~Xs"). New const `SHOW_REVEAL_STATUS` from VITE_SHOW_REVEAL_STATUS.
- **FE `src/styles.css`** — `.reveal-badge` + `.reveal-badge.ready` styles.

### Problems Solved / Lessons Learned
- [Mint feels broken/frozen]: the dead time was a pre-popup block wait, not perf. Fix = shrink buffer + run waits concurrently + live status, and skip the wait entirely when the block already passed.
- [Fast-path cannot be gamed]: all security is on-chain/in-signature (revealBlock is SIGNED; contract checks block.number>revealBlock and blockhash!=0; locked one-session-per-wallet prevents re-roll). Client skipping the wait only lets a VALID mint go sooner; sending early just reverts.
- [Hide the fast-path badge]: set VITE_SHOW_REVEAL_STATUS=false. To hide the whole GENERATE RANDOM & MINT owner feature, gate the ControlPanel(~1646)+ResultPanel(~1798) buttons behind a similar flag (offered, not yet wired).
- TRUST_PROXY guidance: use 1 behind a single managed proxy/LB (real client IP for rate limiting); never `true` (express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY + spoofable); 2 only if stacking Cloudflare+host LB; false for no proxy.
- Note: user/linter added Redis (config/redis.js, rate-limit-redis, idempotency middleware) for shared rate-limit + idempotency across instances — the real crash-safety net at scale.

### Goals & Next Steps
- Restart BE to pick up REVEAL_BUFFER_BLOCKS=1; FE changes live on vite reload.
- Optional: wire VITE_SHOW_RANDOM_MINT flag to hide the random-mint buttons from normal players.
- Verified: FE eslint clean + `vite build` pass; BE env.js `node --check` ok.

---
