# 01 — Architecture

## System Overview

```
┌──────────────────────────────────────────────────┐
│                   RegAuth (port 3000)             │
│  Node Registry  │  Miner  │  Full Chain Copy      │
└────────┬─────────────────────────────────────────┘
         │  register / heartbeat / broadcast
   ┌─────┴──────┬────────────┐
   ▼            ▼            ▼
ProjA (3001) ProjB (3002) ProjC (3003) …
Full chain   Full chain   Full chain
Submit txns  Submit txns  Submit txns
```

- Every node runs the **same `index.js`** — role is determined by `projId` at startup.
- `projId = '0'` → RegAuth behaviour (creates genesis block, mines blocks).
- `projId = '1'+'` → Project node behaviour (waits for sync on startup).

---

## Node Startup Flow

```
index.js starts
  → initDb()          open SQLite, create tables
  → if RegAuth + no blocks: create genesis block
  → if project node + no blocks: resolve (index.js will sync)
  → app.listen()
  → GET /api/blocks from RegAuth   (startup chain sync)
  → setInterval: mine check   (every MINE_CHECK_INTERVAL_MS = 10 s)
  → setInterval: heartbeat    (every HEARTBEAT_INTERVAL_MS = 30 s)
  → setInterval: integrity    (every INTEGRITY_CHECK_INTERVAL_MS = 5 min)
```

---

## Data Model

### `bchain`
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
blockIndex       INTEGER UNIQUE NOT NULL
timestamp        TEXT NOT NULL
transactions     TEXT NOT NULL   -- JSON: [{transactionId, rowHash}, …]
nonce            INTEGER DEFAULT 0
hash             TEXT NOT NULL
previousBlockHash TEXT NOT NULL
merkleRoot       TEXT NOT NULL
```

### `mempool_transactions`
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
transactionId    TEXT UNIQUE NOT NULL
projId           TEXT NOT NULL
stationId        TEXT NOT NULL
timestamp        TEXT NOT NULL
rawData          TEXT NOT NULL   -- JSON: {SO2, NO2, PM10, PM2_5}
rowHash          TEXT NOT NULL
```

### `confirmed_transactions`
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
blockId          INTEGER NOT NULL REFERENCES bchain(id)
transactionId    TEXT NOT NULL
projId           TEXT NOT NULL
stationId        TEXT NOT NULL
timestamp        TEXT NOT NULL
rawData          TEXT NOT NULL
rowHash          TEXT NOT NULL
```

### `audit_log`
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
timestamp        TEXT NOT NULL
event_type       TEXT NOT NULL   -- e.g. 'TAMPERING_DETECTED'
details          TEXT
```

---

## Hashing Formulas

| What | Formula |
|---|---|
| `rowHash` | `SHA-256(transactionId + timestamp + rawDataJson)` |
| `blockHash` | `SHA-256(blockIndex + timestamp + merkleRoot + previousBlockHash + nonce + JSON([{id,hash}…]))` |
| Genesis hash | `SHA-256('regulator_genesis_block_v1')` |
| Chain hash | Rolling `SHA-256` over all block hashes in sequence |

All hashing uses Node's built-in `crypto` module (`createHash('sha256')`).

---

## Tech Stack (Version 0)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js | Current LTS |
| Framework | Express 5.1 | Async error propagation built-in |
| Database | SQLite3 (sqlite3 v5.1.7) | Per-node file; `data/<name>.db` |
| HTTP client | Axios v1.10.0 | All inter-node calls |
| ID generation | UUID v11 (v4 currently; v7 planned) | QW-1 in TODO |
| Hashing | Node `crypto` (SHA-256) | `sha256` npm package is unused — QW-2 to remove |
| Config | `config.js` | Single source of truth for all constants |

---

## Architecture Decision Records

### ADR-001 — SQLite over PostgreSQL (Version 0)
- **Status**: Accepted  
- **Context**: PoC phase; need zero-friction local setup  
- **Decision**: Each node owns its own SQLite file under `data/`  
- **Consequences**: No shared DB; each node is a full peer. Migrate to PostgreSQL + Prisma in V1.

### ADR-002 — Proof of Authority consensus
- **Status**: Accepted  
- **Context**: Regulatory domain — trust is not distributed; the regulator *is* the authority  
- **Decision**: RegAuth alone mines blocks; nonce = 0; no computational puzzle  
- **Consequences**: Simple implementation; not decentralised by design.

### ADR-003 — REST over HTTP for P2P transport
- **Status**: Accepted for V0  
- **Context**: Simplest transport; team familiar with REST  
- **Decision**: All inter-node calls are `axios.post` to `http://<peer>/api/<route>`  
- **Consequences**: Polling-based; evaluate WebSocket or gRPC in V1 if latency matters.
