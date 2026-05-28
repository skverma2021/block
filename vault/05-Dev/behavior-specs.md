# Behaviour Specifications — Version 0

Derived from the Jest test suite (`tests/scenario-*.test.js`).
All 19 tests pass as of the completion of Version 0 dev.

---

## Scenario A — Transaction Lifecycle (Unit)

### A1 · Transaction creation and hashing
- **Precondition:** DB initialised, empty mempool.
- **Trigger:** `createTransaction(projId, submitterId, stationID, SO2, NO2, PM10, PM2_5)`.
- **Expected response:** Returns object with `transactionId`, `timestamp`, `rowHash`, and all input fields.
- **Observable evidence:** `rowHash` is a 64-char hex string; `transactionId` matches UUID format.

### A2 · Transaction persisted to mempool
- **Precondition:** A2 follows A1.
- **Trigger:** Read back via `readAllTransactions()`.
- **Expected:** The created transaction is present in the returned array.

### A3 · Mempool count reflects pending transactions
- **Trigger:** `getMempoolCount()` after inserting N transactions.
- **Expected:** Returns `{ count: N }`.

### A4 · rowHash integrity — tamper detection
- **Trigger:** Compute `SHA-256(tx.transactionId + tx.timestamp + JSON(readings))` independently.
- **Expected:** Matches `tx.rowHash` exactly. (Verifies hash formula is stable.)

### A5 · Genesis block created correctly
- **Trigger:** `initDb()` on a fresh database.
- **Expected:** `getAllBlocks()` returns exactly 1 block at index 0, with `prevHash = 'GENESIS'` and no transactions.

---

## Scenario B — Network & Broadcast (Integration, axios mocked)

### B1 · Transaction broadcast to peer on submit
- **Precondition:** Node has a registered peer. `axios.post` mocked to resolve.
- **Trigger:** POST `/api/transactions/submit` with valid payload.
- **Expected response:** HTTP 201; body contains `{ note, transaction, broadcastStatus }`.
- **Observable evidence:** `axios.post` called with peer's `/api/transactions/receive` URL and transaction payload.

### B2 · Failed broadcast queued as pending
- **Precondition:** `axios.post` mocked to reject.
- **Trigger:** POST `/api/transactions/submit`.
- **Expected:** Transaction still created; `broadcastStatus` indicates failure; pending count > 0.

### B3 · RegAuth health endpoint returns online status
- **Trigger:** GET `/api/network/regauth-status`.
- **Expected:** `{ isRegAuthOnline: boolean, lastCheck, pendingBroadcastCount, regAuthUrl }`.

### B4 · Node health endpoint
- **Trigger:** GET `/api/network/health`.
- **Expected:** `{ status: 'online', nodeUrl, timestamp }`.

---

## Scenario C — Chain Integrity (Integration, no mock)

### C1 · Chain verifies as valid on a fresh DB
- **Trigger:** GET `/api/blocks/verify-integrity` on a DB with only the genesis block.
- **Expected:** `{ valid: true }`.

### C2 · Block is mined when mempool threshold is reached
- **Precondition:** `TRANSACTIONS_PER_BLOCK = 3` (test override). Submit 3 transactions.
- **Trigger:** The 3rd submit triggers `mineBlockInternal()`.
- **Expected:** `getAllBlocks()` returns 2 blocks (genesis + 1 mined).

### C3 · Mined block contains correct transaction count
- **Trigger:** Inspect the mined block from C2.
- **Expected:** `block.transactions.length === 3`.

### C4 · Block hash is valid
- **Trigger:** Recompute `SHA-256(index + timestamp + merkleRoot + prevHash + nonce + txIds)`.
- **Expected:** Matches `block.blockHash`.

### C5 · Merkle root is correct
- **Trigger:** Recompute SHA-256 tree from transaction rowHashes.
- **Expected:** Matches `block.merkleRoot`.

### C6 · prevHash chain linkage is correct
- **Trigger:** Inspect `blocks[1].prevHash`.
- **Expected:** Equals `blocks[0].blockHash`.

### C7 · Chain integrity passes after mining
- **Trigger:** GET `/api/blocks/verify-integrity`.
- **Expected:** `{ valid: true }`.

### C8 · Tampered block detected by integrity check
- **Trigger:** Direct DB update to change a transaction's `SO2` value in a mined block, then GET `/api/blocks/verify-integrity`.
- **Expected:** `{ valid: false, corruptedBlockIndex: N }`.

### C9 · Tamper detection creates audit log entry
- **Trigger:** After C8, GET `/api/blocks/security-alerts`.
- **Expected:** `count >= 1`; alert `event_type` contains `'INTEGRITY'` or `'TAMPER'`.

### C10 · Chain can be purged and resynced
- **Trigger:** `purgeBlockchainFrom(1)` then re-mine.
- **Expected:** `getAllBlocks()` returns only the genesis block; subsequent mining works correctly.
