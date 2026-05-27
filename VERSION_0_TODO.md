# Version 0 — TODO

## BUG FIXES

- [x] **BUG-1** `routes/blocks.js`, `routes/transactions.js`, `routes/network.js`  
  All inter-node broadcast URLs were missing the `/api` prefix. Fixed in all 5 locations.

- [x] **BUG-2** `routes/network.js` — `flushPendingBroadcasts()`  
  Transaction retry URL fixed: `${url}/api/transactions/receive`

- [x] **BUG-3** `routes/network.js` — `module.exports`  
  `myNodeUrl` now exported as a getter: `get myNodeUrl() { return myNodeUrl; }`

- [x] **BUG-4** `REG_AUTH_URL` hardcoded — now the 6th CLI argument in both files  
  `node index.js <port> <myUrl> <projId> <dbFile> <regAuthUrl>`  
  Defaults to `http://localhost:3000` if omitted (backward compatible).  
  `routes/network.js` exposes `setRegAuthUrl()` and receives the value from `index.js` on startup.

- [x] **BUG-5** `db.js` — genesis block hash and Merkle root used unique sentinel values  
  (`SHA-256('regulator_genesis_block_v1')` and `SHA-256('genesis_merkle_root_v1')`) that  
  `verifyBlockIntegrity()` can never reproduce — causing a self-purge on every RegAuth restart.  
  Fix: genesis block now uses the standard hash formula (same as all other blocks):  
  `merkleRoot = calculateMerkleRoot([])` and `hash = SHA-256(0 + timestamp + merkleRoot + '0' + 0 + '[]')`

---

## QUICK WINS

- [x] **QW-1** `db.js` — UUID v4 → v7  
  `uuidv4()` → `uuidv7()` (already available in `uuid` v11, zero new dependency)

- [x] **QW-2** `package.json` — Remove unused `sha256` dependency  
  All hashing uses Node's built-in `crypto`. Run `npm uninstall sha256`.

- [x] **QW-3** Consolidate duplicate threshold constants  
  `MINE_THRESHOLD = 5` in `index.js` and `BLOCK_SIZE = 5` in `routes/blocks.js`  
  Define once (e.g. in a `config.js`) and import in both files.

---

## PERSISTENCE FIX

- [~] **PF-1** `routes/network.js` — Persist retry queue to SQLite  
  **Deferred to V1.** `pendingBroadcasts` is an in-memory array — lost on process restart.  
  For V0 this is acceptable: transactions remain safely in the local SQLite mempool; only  
  the delivery-retry intent is lost. In V1 this will be replaced by a proper job queue  
  (BullMQ or a PostgreSQL-backed queue) — hand-rolling a SQLite solution here would be  
  thrown away immediately. TEST-B5 is marked as a V1 responsibility accordingly.

---

## JEST SETUP

- [ ] **TEST-0** Install and configure Jest  
  `npm install --save-dev jest`  
  Add `"test": "jest"` to `package.json` scripts.  
  Create `tests/` directory.

---

## JEST — SCENARIO A: Project Node Recovery

> Goal: Node automatically catches up on missed blocks when it comes back online.

- [ ] **TEST-A1** Node with no local blocks syncs full chain from RegAuth on startup
- [ ] **TEST-A2** Node that is behind by N blocks fetches only the missing blocks (partial sync)
- [ ] **TEST-A3** Chain continuity validation — reject a partial sync where `previousBlockHash` does not match
- [ ] **TEST-A4** Fork detected during partial sync → force resync from RegAuth is triggered
- [ ] **TEST-A5** Node already up to date — no sync attempted, no errors

---

## JEST — SCENARIO B: RegAuth Unavailability

> Goal: Project nodes gracefully handle RegAuth being offline.

- [ ] **TEST-B1** `checkRegAuthHealth()` returns `false` when RegAuth is unreachable; `isRegAuthOnline` set to `false`
- [ ] **TEST-B2** Transaction submitted while RegAuth offline → stored in local mempool + added to persistent retry queue
- [ ] **TEST-B3** `flushPendingBroadcasts()` fires when RegAuth comes back online; queue is cleared from DB on success
- [ ] **TEST-B4** Retry gives up after 5 attempts; final failure is logged
- [~] **TEST-B5** Node process restarts while RegAuth is down → retry queue survives (reads from DB on startup)  
  *Deferred to V1 — requires PF-1 which is a V1 responsibility.*

---

## JEST — SCENARIO C: Tamper Detection and Resync

> Goal: Detect and reject corrupted blocks/chains; force resync with authoritative chain.

- [ ] **TEST-C1** `verifyBlockIntegrity()` detects a modified block hash
- [ ] **TEST-C2** `verifyBlockIntegrity()` detects a broken `previousBlockHash` chain link
- [ ] **TEST-C3** `verifyBlockIntegrity()` detects a Merkle root mismatch
- [ ] **TEST-C4** `verifyBlockIntegrity()` detects a tampered transaction `rowHash` within a block
- [ ] **TEST-C5** `verifyChainIntegrity()` identifies the correct `corruptedBlockIndex` and logs to `audit_log`
- [ ] **TEST-C6** Chain hash mismatch with RegAuth → `logTamperingAlert` called with `CHAIN_HASH_MISMATCH`
- [ ] **TEST-C7** `forceResyncFromRegAuth()` purges local chain and rebuilds from RegAuth correctly
- [ ] **TEST-C8** Post-resync integrity check passes; `audit_log` retains the original alert (resolved = 0)
- [ ] **TEST-C9** Received block with invalid hash is rejected at `POST /api/blocks/receive` (Check-4)
- [ ] **TEST-C10** Received block with invalid Merkle root is rejected (Check-5)

---

## INTEGRATION VALIDATION

- [ ] **INT-1** Postman collection — one request per API route  
  Cover: `/api/transactions/submit`, `/api/transactions/receive`, `/api/transactions/`  
  `/api/blocks/mine`, `/api/blocks/receive`, `/api/blocks/chain`, `/api/blocks/chain-from/:startIndex`  
  `/api/blocks/last-index`, `/api/blocks/chain-hash`, `/api/blocks/verify-integrity`  
  `/api/blocks/security-alerts`  
  `/api/network/health`, `/api/network/regauth-status`, `/api/network/register-and-broadcast-node`  
  `/api/network/register-node`, `/api/network/register-nodes-bulk`

- [ ] **INT-2** Postman environment files for single-machine (localhost) and two-machine (LAN IP) setups

---

## VAULT (Foundation for Version 1)

- [ ] **VAULT-1** TypeScript interface definitions (draft in plain `.ts` files, no compilation needed)  
  `IBlock`, `ITransaction`, `INetworkNode`, `IPendingBroadcast`, `IAuditLogEntry`  
  These become Prisma schema entities and NestJS DTOs in Version 1.

- [ ] **VAULT-2** Behavior specifications — one document per scenario (A, B, C)  
  Each spec states: preconditions, trigger, expected system response, observable evidence.  
  The Jest tests in this file ARE the machine-readable version of these specs.

- [ ] **VAULT-3** Known limitations list  
  - HTTP polling (10s lag)  
  - No TLS / all traffic in plaintext  
  - No API authentication between nodes  
  - Single miner (RegAuth) — bottleneck and single point of failure for block production  
  - No input range validation for sensor readings (SO2, NO2, PM10, PM2_5)  
  - Static network topology (manual node registration)  
  - Genesis block hash is deterministic (hardcoded input string)

- [ ] **VAULT-4** Architecture decisions log  
  - Why PoA (not PoW/PoS)  
  - Why per-node SQLite (not shared DB)  
  - Why RegAuth is sole miner  
  - Why SHA-256 rowHash = transactionId + timestamp + rawDataJson  
  - Why lightweight tx references in `bchain.transactions` + full data in `confirmed_transactions`

---

## COMPLETION CRITERIA FOR VERSION 0

- All BUG and QW items resolved  
- `npm test` passes with zero failures across all A, B, C scenarios  
- Postman collection covers all routes and runs clean against a local 4-node setup  
- Vault artefacts committed  
- Two-machine demo runs: `docker-compose` not required, plain `node` commands with correct CLI args
