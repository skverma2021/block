# Known Limitations — Version 0

These are accepted limitations of the Version 0 proof-of-concept.
They are tracked in `VERSION_0_TODO.md` and scheduled for V1 or later.

---

## Protocol / Security

| ID | Limitation | Impact | V1 Plan |
|---|---|---|---|
| LIM-01 | **HTTP only — no TLS** | Sensor readings are transmitted in cleartext. | Use HTTPS with self-signed or Let's Encrypt certs. |
| LIM-02 | **No API authentication** | Any client on the network can submit transactions or trigger integrity checks. | Add token-based auth (e.g. JWT) on all write endpoints. |
| LIM-03 | **No input validation** | Numeric sensor fields (SO2, NO2, PM10, PM2_5) are not range-checked. | Add server-side validation middleware. |
| LIM-04 | **Static node topology** | Nodes are registered at startup only; no dynamic join/leave. | Implement gossip-based peer discovery. |

## Consensus / Mining

| ID | Limitation | Impact | V1 Plan |
|---|---|---|---|
| LIM-05 | **Single miner (PoA)** | If RegAuth goes offline, no new blocks are mined. All transactions stall in mempool. | Evaluate multi-RegAuth (e.g. 2-of-3 PoA with BFT). |
| LIM-06 | **Deterministic genesis block** | Genesis block hash is computed from empty transactions + standard formula. Easy to predict. | Accept for V0; consider seeding with a random nonce in V1. |

## Reliability / Operations

| ID | Limitation | Impact | V1 Plan |
|---|---|---|---|
| LIM-07 | **HTTP polling — ~10s lag** | Frontend polls every 5s; new blocks appear up to 5s late. | Switch to WebSocket push notifications. |
| LIM-08 | **Pending broadcasts lost on restart** | `pendingBroadcasts[]` is in-memory only (BUG-PF-1). Failed broadcasts are dropped on process exit. | Persist to DB or use a job queue (BullMQ). |
| LIM-09 | **No chain sync on startup** | Project nodes that restart do not automatically sync missed blocks from RegAuth. | Implement `GET /api/blocks/chain` pull on startup. |
| LIM-10 | **SQLite concurrency** | Only one writer at a time. Not suitable for high-throughput multi-node writes. | Migrate to PostgreSQL in V1. |

## Frontend / UX

| ID | Limitation | Impact | V1 Plan |
|---|---|---|---|
| LIM-11 | **No user authentication in frontend** | The submit form is open to anyone who can reach the node. | Pair with API auth (LIM-02). |
| LIM-12 | **No mempool visibility** | Frontend shows confirmed blocks only; pending transactions are not displayed. | Add a mempool panel to the frontend. |
