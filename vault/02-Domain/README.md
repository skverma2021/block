# 02 — Domain

## Environmental Monitoring Context

The system records air quality readings from monitoring stations operated by project nodes. Each reading captures four pollutant measurements at a point in time.

### Measurement Fields

| Field | Pollutant | Typical unit |
|---|---|---|
| `SO2` | Sulphur dioxide | µg/m³ |
| `NO2` | Nitrogen dioxide | µg/m³ |
| `PM10` | Particulate matter ≤ 10 µm | µg/m³ |
| `PM2_5` | Particulate matter ≤ 2.5 µm | µg/m³ |

### Why Blockchain?

Readings submitted to a traditional database can be silently edited. A blockchain provides:
- **Tamper evidence** — altering any reading breaks the block hash and chain hash.
- **Audit trail** — the `audit_log` table records any detected tampering event.
- **Non-repudiation** — once a reading is mined into a block, its `rowHash` is permanently embedded.

---

## Node Roles

### Regulatory Authority (RegAuth)
- `projId = '0'`
- **Only** node that mines blocks.
- Creates the genesis block on first run.
- Maintains the node registry — all project nodes register with RegAuth on startup.
- Runs the heartbeat monitor: detects unresponsive nodes and flags them.
- Acts as the canonical chain source: project nodes sync from RegAuth on startup.

### Project Node
- `projId = '1'`, `'2'`, `'3'` …
- Submits environmental readings via `POST /api/transactions/submit`.
- Broadcasts accepted transactions to all peers.
- Receives mined blocks from RegAuth via `POST /api/blocks/receive`.
- Holds a full local copy of the chain for independent verification.

---

## Proof of Authority (PoA)

PoA is appropriate here because:
- The regulatory domain already has a single trusted authority.
- Computational puzzles (PoW) would add cost and latency with no benefit.
- The goal is **auditability**, not **decentralisation**.

**Mining trigger**: RegAuth polls the mempool every `MINE_CHECK_INTERVAL_MS` (10 s). When the mempool reaches `TRANSACTIONS_PER_BLOCK` (5) pending transactions, a block is mined.

**Nonce**: Always `0` — no puzzle to solve.

---

## Transaction Lifecycle

```
Station submits reading
  → POST /api/transactions/submit (any node)
      → validate fields
      → generate transactionId (UUID), timestamp, rowHash
      → INSERT into mempool_transactions
      → broadcast to all peers via POST /api/transactions/receive

RegAuth mine check (every 10 s)
  → if mempool count >= TRANSACTIONS_PER_BLOCK
      → getTransactionsForBlock(5)
      → compute Merkle root
      → build block, compute blockHash
      → INSERT block into bchain
      → INSERT transactions into confirmed_transactions
      → DELETE transactions from mempool
      → broadcast block to all peers via POST /api/blocks/receive

Project node receives block
  → verify previousBlockHash matches its local chain tip
  → INSERT block
  → (confirmed_transactions inserted by the route handler)
```

---

## Integrity Verification

Every node runs an integrity check every `INTEGRITY_CHECK_INTERVAL_MS` (5 min):
1. Recompute `rowHash` for every confirmed transaction — compare to stored value.
2. Recompute `blockHash` for every block — compare to stored value.
3. Recompute the chain hash over all blocks — compare to expected.
4. Any mismatch → insert a row in `audit_log` with `event_type = 'TAMPERING_DETECTED'`.
