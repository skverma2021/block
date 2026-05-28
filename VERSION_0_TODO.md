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

- [x] **BUG-6** `routes/network.js` — `flushPendingBroadcasts()` retry logic was dead code  
  Individual URL failures were caught as `null` inside `.map()`, so `Promise.all` always resolved  
  and the outer `catch` (with re-queue logic) never ran. Items were silently dropped after one  
  failed flush regardless of `MAX_BROADCAST_RETRIES`.  
  Fix: `.then(→true)/.catch(→false)` per URL; check `anySucceeded`; if all failed and under  
  the retry limit, re-queue with warning log; otherwise discard with error log.

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

- [x] **TEST-0** Install and configure Jest  
  `npm install --save-dev jest supertest`  
  Add `"test": "jest --runInBand"` to `package.json` scripts.  
  Created `tests/`, `tests/helpers/blockBuilder.js`, `tests/helpers/dbSetup.js`.

---

## JEST — SCENARIO A: Project Node Recovery

> Goal: Node automatically catches up on missed blocks when it comes back online.

- [x] **TEST-A1** Empty project-node DB → `getLastBlockIndex()` returns -1 (sync trigger condition)
- [x] **TEST-A2** `getBlocksFromIndex(n)` returns only blocks with index strictly > n (partial sync slice)
- [x] **TEST-A3** Chain with broken `previousBlockHash` link fails `verifyChainIntegrity` at the bad block
- [x] **TEST-A4** `purgeBlockchainFrom(corruptedIndex)` + re-add correct blocks restores a valid chain
- [x] **TEST-A5** `getLastBlockIndex()` reflects correct value after blocks are added

---

## JEST — SCENARIO B: RegAuth Unavailability

> Goal: Project nodes gracefully handle RegAuth being offline.

- [x] **TEST-B1** `checkRegAuthHealth()` returns `false` and sets `regAuthStatus` to `false` when unreachable
- [x] **TEST-B2** `addToPendingBroadcasts()` queues a transaction; duplicate entries are deduplicated
- [x] **TEST-B3** `flushPendingBroadcasts()` calls `axios.post` for every queued item; queue is empty after success
- [x] **TEST-B4** Item is dropped permanently after `MAX_BROADCAST_RETRIES` (5) consecutive failures
- [~] **TEST-B5** Node process restarts while RegAuth is down → retry queue survives (reads from DB on startup)  
  *Deferred to V1 — requires PF-1 which is a V1 responsibility.*

---

## JEST — SCENARIO C: Tamper Detection and Resync

> Goal: Detect and reject corrupted blocks/chains; force resync with authoritative chain.

- [x] **TEST-C1** Modified block hash → `verifyChainIntegrity()` returns `valid=false`, error matches `/hash mismatch/i`
- [x] **TEST-C2** Broken `previousBlockHash` → error matches `/previous hash mismatch/i`
- [x] **TEST-C3** Tampered `merkleRoot` → error matches `/merkle root mismatch/i`
- [x] **TEST-C4** Tampered transaction `rowHash` → error references the corrupted transaction ID
- [x] **TEST-C5** `verifyChainIntegrity()` reports correct `corruptedBlockIndex` in a 2-block chain
- [x] **TEST-C6** `calculateChainHash()` returns different hash after block corruption
- [x] **TEST-C7** `purgeBlockchainFrom(index)` removes correct blocks; chain length is as expected
- [x] **TEST-C8** `audit_log` retains `CHAIN_INTEGRITY_FAILURE` entry after purge + valid rebuild
- [x] **TEST-C9** `POST /api/blocks/receive` rejects block with invalid hash (Check-4 → 400)
- [x] **TEST-C10** `POST /api/blocks/receive` rejects block with invalid Merkle root (Check-5 → 400)

---

## INTEGRATION VALIDATION

- [x] **INT-1** Postman collection — one request per API route  
  Created: `postman/Pollution-Monitoring-Blockchain.postman_collection.json`  
  Covers all 16 routes across 4 folders: 00 Network Setup, 01 Transactions, 02 Blocks, 03 Network Status.

- [x] **INT-2** Postman environment files for single-machine (localhost) and two-machine (LAN IP) setups  
  Created: `postman/env-localhost.postman_environment.json` — all 3 nodes on localhost  
  Created: `postman/env-lan.postman_environment.json` — RegAuth on Machine 1, projA/B on Machine 2

---

## VAULT (Foundation for Version 1)

- [x] **VAULT-1** TypeScript interface definitions (draft in plain `.ts` files, no compilation needed)  
  `IBlock`, `ITransaction`, `INetworkNode`, `IPendingBroadcast`, `IAuditLogEntry`  
  Created: `vault/01-Architecture/types.ts`

- [x] **VAULT-2** Behavior specifications — one document per scenario (A, B, C)  
  Each spec states: preconditions, trigger, expected system response, observable evidence.  
  Created: `vault/05-Dev/behavior-specs.md`

- [x] **VAULT-3** Known limitations list  
  Created: `vault/00-Project/limitations.md` (12 items: LIM-01 to LIM-12)

- [x] **VAULT-4** Architecture decisions log  
  Updated: `vault/00-Project/README.md` — glossary genesis block hash corrected (BUG-5 fix reflected);
  `vault/05-Dev/README.md` — all bugs marked Fixed, QW-1/QW-2 marked Done.

---

## COMPLETION CRITERIA FOR VERSION 0

- All BUG and QW items resolved  
- `npm test` passes with zero failures across all A, B, C scenarios  
- Postman collection covers all routes and runs clean against a local 4-node setup  
- Vault artefacts committed  
- Two-machine demo runs: `docker-compose` not required, plain `node` commands with correct CLI args
