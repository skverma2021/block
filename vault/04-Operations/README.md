# 04 — Operations

## Node Startup

### Command syntax
```
node index.js <port> <myNodeUrl> <projId> <dbFileName>
```

| Arg | Example | Description |
|---|---|---|
| `port` | `3000` | Port this node listens on |
| `myNodeUrl` | `http://localhost:3000` | Publicly reachable URL for this node |
| `projId` | `0` | `'0'` = RegAuth; `'1'`, `'2'`… = project nodes |
| `dbFileName` | `regauth.db` | SQLite file name (stored under `data/`) |

> **TODO BUG-4**: `REG_AUTH_URL` is currently hardcoded to `http://localhost:3000` in the source. A 5th CLI argument is planned so project nodes can point at a remote RegAuth.

---

## Standard Local Setup (4 nodes)

Open four separate terminals from `c:\block`:

```powershell
# Terminal 1 — RegAuth
node index.js 3000 http://localhost:3000 0 regauth.db

# Terminal 2 — Project A
node index.js 3001 http://localhost:3001 1 proja.db

# Terminal 3 — Project B
node index.js 3002 http://localhost:3002 2 projb.db

# Terminal 4 — Project C
node index.js 3003 http://localhost:3003 3 projc.db
```

**Startup order**: RegAuth must be up before project nodes, since project nodes sync the chain from RegAuth on boot.

---

## Joining a New Node

After starting the node, register it with RegAuth so it is broadcast to all existing peers:

```http
POST http://localhost:3000/api/network/register-and-broadcast-node
Content-Type: application/json

{ "nodeUrl": "http://localhost:3004" }
```

This calls `register-nodes-bulk` on all known nodes, so the new node ends up in every peer's registry.

---

## Database Files

SQLite files are stored under `data/` and are excluded from git (see `.gitignore`).

| File | Node |
|---|---|
| `data/regauth.db` | RegAuth |
| `data/proja.db` | Project A |
| `data/projb.db` | Project B |
| `data/projc.db` | Project C |

To reset a node to a clean state: stop the node, delete its `.db` file, restart. RegAuth should be reset first if resetting all nodes.

---

## Background Intervals

| Interval | Period | What it does |
|---|---|---|
| Mine check | 10 s (`MINE_CHECK_INTERVAL_MS`) | RegAuth: mines if mempool ≥ 5 transactions |
| Heartbeat | 30 s (`HEARTBEAT_INTERVAL_MS`) | Pings all registered peers; flags unresponsive nodes |
| Integrity check | 5 min (`INTEGRITY_CHECK_INTERVAL_MS`) | Recomputes all hashes; logs tampering to `audit_log` |

---

## Graceful Shutdown

`Ctrl+C` triggers `SIGINT` handler in `index.js`:
1. Clears all three intervals.
2. Calls `db.closeDb()` to flush and close the SQLite connection.
3. Exits with code `0`.

---

## Checking Node Health

```http
GET http://localhost:3000/api/network/health
GET http://localhost:3000/api/network/status
```
