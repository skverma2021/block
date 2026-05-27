# 05 — Dev

## Bug Register

| ID | Severity | Status | Location | Description |
|---|---|---|---|---|
| BUG-1 | **Critical** | Open | `routes/blocks.js`, `routes/transactions.js`, `routes/network.js` | All inter-node `axios.post` calls are missing the `/api` prefix — peer nodes never receive blocks or transactions. Fix: prepend `/api` to every inter-node POST URL. |
| BUG-2 | High | Open | `routes/network.js` — `flushPendingBroadcasts()` | Retry flush also uses the wrong URL path (`/transactions/receive` not `/api/transactions/receive`). |
| BUG-3 | Low | Open | `routes/network.js` — `module.exports` | `myNodeUrl` is exported as a primitive value snapshot (always `''`). Fix: export as a getter `get myNodeUrl() { return myNodeUrl; }`. |
| BUG-4 | Medium | Open | `index.js`, `routes/network.js` | `REG_AUTH_URL` is hardcoded to `'http://localhost:3000'`. Fix: make it a 5th CLI argument so the system can run across machines. |

### BUG-1 Detail — Affected locations

```
routes/blocks.js       axios.post(`${networkNodeUrl}/blocks/receive`, …)
routes/transactions.js axios.post(`${networkNodeUrl}/transactions/receive`, …)
routes/network.js      axios.post(`${url}/network/register-node`, …)
routes/network.js      axios.post(`${url}/network/register-nodes-bulk`, …)
routes/network.js      axios.post(`${url}/transactions/receive`, …)  ← in flushPendingBroadcasts
```

All five should have `/api` inserted after the host: `${networkNodeUrl}/api/blocks/receive`, etc.

---

## Quick Wins Register

| ID | Status | Description |
|---|---|---|
| QW-1 | Open | Switch `uuidv4()` → `uuidv7()` in `db.js`. UUID v7 is time-ordered; better for DB indexing. Package already installed. |
| QW-2 | Open | Remove `sha256` npm package (`npm uninstall sha256`). Unused — all hashing uses Node's built-in `crypto`. |
| QW-3 | **Done** | Duplicate `MINE_THRESHOLD = 5` (index.js) and `BLOCK_SIZE = 5` (blocks.js) consolidated into `config.TRANSACTIONS_PER_BLOCK`. |

---

## Version 0 TODO

See [../VERSION_0_TODO.md](../VERSION_0_TODO.md) for the full tracked checklist.

### Summary
- [ ] Fix BUG-1 through BUG-4
- [ ] QW-1: UUID v7
- [ ] QW-2: Remove sha256 package
- [x] QW-3: Consolidate duplicate constants → `config.js`
- [ ] PF-1: Persist `pendingBroadcasts` across restarts (currently in-memory)
- [ ] Jest setup + Scenario A (unit), B (integration), C (chain integrity)

---

## Testing Notes

### Pre-requisites
- All four nodes running (see `04-Operations/README.md`)
- Nodes registered with each other

### Scenario A — Unit Tests (planned, Jest)
- `computeMerkleRoot()` with known inputs
- `mineBlockInternal()` with a fixture mempool
- `createTransaction()` rowHash correctness
- `verifyChainIntegrity()` with a clean chain
- `verifyChainIntegrity()` with a tampered transaction

### Scenario B — Integration Tests (planned, Jest + supertest)
- Submit a transaction, check it appears in mempool
- Submit 5 transactions, verify a block is mined
- Receive a block, verify it is appended to the local chain
- Register a node, verify it appears in the peer list
- Submit a duplicate transaction, expect `409`

### Scenario C — Chain Integrity Tests (planned)
- Full 3-node network: submit 15 transactions, verify all three chains match
- Tamper a row in SQLite directly, verify `audit_log` captures it
- (8 more scenarios TBD)

---

## Version 1 Spec (overview)

Full spec in `06-Roadmap/README.md`.

| Area | V0 | V1 |
|---|---|---|
| Language | JavaScript | TypeScript |
| Framework | Express 5 | NestJS |
| ORM | Raw SQL (sqlite3) | Prisma |
| Database | SQLite (per node) | PostgreSQL (shared per env) |
| Containerisation | None | Docker + Docker Compose |
| Frontend | None | React (Vite) |
| Auth | None | JWT (planned) |
