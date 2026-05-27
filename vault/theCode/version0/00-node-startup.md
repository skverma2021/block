# 00 — Node Startup & Configuration

## Purpose
Every node in the network runs the same `index.js`. The role (RegAuth vs project node) and identity are determined entirely by command-line arguments.

## Entry Point

**File**: [`index.js`](../../../index.js)

```
node index.js <port> <myNodeUrl> <projId> <dbFileName>
```

| Position | Arg | Example | Effect |
|---|---|---|---|
| `argv[2]` | `port` | `3000` | TCP port Express listens on |
| `argv[3]` | `myNodeUrl` | `http://localhost:3000` | This node's publicly reachable URL |
| `argv[4]` | `projId` | `0` | `'0'` = RegAuth; any other value = project node |
| `argv[5]` | `dbFileName` | `regauth.db` | SQLite file under `data/` |

## Code Walkthrough

### Section 1 — Argument parsing and module wiring
**`index.js` lines 33–42**

```js
const PORT        = process.argv[2] || 3000;
const MY_NODE_URL = process.argv[3];
const REG_AUTH_ID = process.argv[4];
const DB_FILE_NAME = process.argv[5] || 'default.db';

db.setProjId(REG_AUTH_ID);
db.setDbFile(DB_FILE_NAME);
network.setMyNodeUrl(MY_NODE_URL);
```

- `db.setProjId()` → `db.js` — tells the DB layer whether to create a genesis block.
- `db.setDbFile()` → `db.js` — resolves the SQLite file path under `data/`.
- `network.setMyNodeUrl()` → `routes/network.js` — sets the module-level `myNodeUrl` used in all log lines and broadcast exclusion logic.

### Constants (all magic numbers centralised)
**`config.js`** — imported by `index.js`, `routes/blocks.js`, `routes/transactions.js`, `routes/network.js`.

| Constant | Default | Used by |
|---|---|---|
| `TRANSACTIONS_PER_BLOCK` | `5` | Mining trigger check |
| `MINE_CHECK_INTERVAL_MS` | `10 000` | `setInterval` in `startServer()` |
| `HEARTBEAT_INTERVAL_MS` | `30 000` | `setInterval` in `startServer()` |
| `BROADCAST_TIMEOUT_MS` | `5 000` | All `axios.post` calls |
| `MAX_BROADCAST_RETRIES` | `5` | `flushPendingBroadcasts` |
| `INTEGRITY_CHECK_INTERVAL_MS` | `300 000` | `setInterval` in `startServer()` |

### Section 2 — Middleware and routes
**`index.js` lines 56–76**

```js
app.use(cors());
app.use(express.json());
app.use('/api/transactions', transactionsRoutes);
app.use('/api/blocks',       blocksRouter);
app.use('/api/network',      network.router);
```

All routes are under `/api`. The root `GET /` returns a one-line health string.

### Section 5 — startServer()
**`index.js` — `async function startServer()`**

Startup sequence:
1. `await db.initDb()` — opens SQLite, creates tables, creates genesis block if RegAuth.
2. Chain sync (project nodes only) — see [06-chain-sync.md](06-chain-sync.md).
3. `setInterval(mineBlockInternal, MINE_CHECK_INTERVAL_MS)` — RegAuth only.
4. `setInterval(checkRegAuthHealth, HEARTBEAT_INTERVAL_MS)` — project nodes only.
5. `setInterval(performIntegrityCheck, INTEGRITY_CHECK_INTERVAL_MS)` — all nodes.
6. `app.listen(PORT, ...)` — begins accepting HTTP connections.

### Section 6 — Graceful shutdown
**`index.js` — `process.on('SIGINT', ...)`**

On `Ctrl+C`:
1. `clearInterval` on all three handles.
2. `await db.closeDb()` — flushes and closes the SQLite connection.
3. `process.exit(0)`.

## Known Issues
- **TODO BUG-4** (`index.js` line 44): `REG_AUTH_URL = 'http://localhost:3000'` is hardcoded. A 5th CLI argument is needed to support cross-machine deployment. The same hardcode exists in `routes/network.js` line 34.
