# 00 — Project

## Brief

A tamper-evident distributed ledger for environmental sensor readings. Project nodes (monitoring stations) submit readings to their local node; those readings are batched into blocks by the Regulatory Authority (RegAuth) and broadcast back to all nodes. Every node holds a full copy of the chain.

The primary goal is auditability: if a reading is altered after submission, the chain hash breaks and the tamper is detected.

---

## Stakeholders

| Role | Description |
|---|---|
| **RegAuth** | Regulatory Authority. Sole miner. Owns the genesis block. Maintains the node registry. Runs on port 3000 by default. |
| **Project Node** | Monitoring station. Submits environmental readings. Receives mined blocks. Identified by a numeric `projId` (1, 2, 3 …). |

---

## Glossary

| Term | Definition |
|---|---|
| **RegAuth** | Regulatory Authority node (`projId = '0'`). |
| **Project Node** | A participating monitoring station (`projId = '1'`, `'2'`, …). |
| **Mempool** | The `mempool_transactions` table — transactions waiting to be mined into a block. |
| **Block** | A group of `TRANSACTIONS_PER_BLOCK` (default: 5) confirmed transactions. |
| **Genesis Block** | Block at index 0. Created only by RegAuth. `blockHash = SHA-256(blockIndex + timestamp + merkleRoot([] empty) + 'GENESIS' + nonce + '[]')` where nonce=0. |
| **PoA** | Proof of Authority — no computational puzzle; RegAuth mines by authority alone. Nonce is always 0. |
| **rowHash** | Per-transaction tamper check: `SHA-256(transactionId + timestamp + rawDataJson)`. |
| **blockHash** | `SHA-256(blockIndex + timestamp + merkleRoot + previousBlockHash + nonce + JSON([{id, hash}…]))` |
| **Merkle Root** | SHA-256 tree root over all `rowHash` values in a block. |
| **Chain Hash** | A rolling hash over all block hashes — used for fast full-chain integrity checks. |
| **Pending Broadcast** | A transaction broadcast that failed and is queued for retry in `pendingBroadcasts[]`. |

---

## Decision Log

| # | Date | Decision | Rationale |
|---|---|---|---|
| D-001 | 2026-05 | SQLite per node (Version 0) | Zero-setup for PoC; each node is self-contained. Migrate to PostgreSQL in V1. |
| D-002 | 2026-05 | Express 5 | Native async error propagation; no need for `express-async-errors` wrapper. |
| D-003 | 2026-05 | PoA consensus | Regulatory domain — trust is centralised by design. RegAuth is the auditor. |
| D-004 | 2026-05 | REST over HTTP for P2P | Simplest transport for a PoC. Evaluate WebSocket or gRPC in V1 if needed. |
| D-005 | 2026-05 | UUID v7 (planned) | v7 is time-ordered, better for DB indexing. Currently using v4 (QW-1 in TODO). |
