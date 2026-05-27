# 01 — Network Registration

## Purpose
Before a project node can participate (receive transactions or blocks), it must register with the network. The `/register-and-broadcast-node` endpoint is the single entry point for joining; the other two are used internally during the join handshake.

## File
[`routes/network.js`](../../../routes/network.js) — Section 5 (lines ~167–260)

---

## Endpoints

### `POST /api/network/register-and-broadcast-node`
Called once by a new node (or by a human via Postman) to join the network.

**Body**: `{ "newNodeUrl": "http://localhost:3001" }`

**What it does** (in `routes/network.js`):

```
Step 1: Add newNodeUrl to this node's networkNodes[] if not already present.
Step 2: For every existing peer (excluding the new node):
          POST /network/register-node  ← notifies peer of the new node
Step 3: POST /network/register-nodes-bulk to newNodeUrl
          ← sends the new node the full current peer list
```

**⚠️ BUG-1** (lines ~193, ~203): Both internal `axios.post` calls are missing the `/api` prefix:
```js
// WRONG (current):
axios.post(`${existingNodeUrl}/network/register-node`, ...)
axios.post(`${newNodeUrl}/network/register-nodes-bulk`, ...)

// CORRECT (after fix):
axios.post(`${existingNodeUrl}/api/network/register-node`, ...)
axios.post(`${newNodeUrl}/api/network/register-nodes-bulk`, ...)
```

---

### `POST /api/network/register-node`
Adds a single peer URL to this node's `networkNodes[]`. Used internally during broadcast, but also callable directly from Postman when testing without the full handshake.

**Body**: `{ "newNodeUrl": "http://localhost:3001" }`

Guards:
- Rejects if `newNodeUrl` is missing → `400`.
- Skips silently if the URL is already known or is this node's own URL.

---

### `POST /api/network/register-nodes-bulk`
Receives an array of peer URLs and adds any unknown ones to `networkNodes[]`. Called on the *new* node by the existing network node after Step 2 above.

**Body**: `{ "allNetworkNodes": ["http://localhost:3000", "http://localhost:3002"] }`

---

## State Managed

All peer state is in-memory in `routes/network.js`:

```js
let networkNodes = [];   // All known peers (excluding self)
let myNodeUrl    = '';   // This node's own URL (set via setMyNodeUrl() on startup)
```

`networkNodes` is also exported and read directly by `routes/transactions.js` and `routes/blocks.js` when broadcasting.

---

## Registration Flow Diagram

```
New node starts
    │
    └─► POST /api/network/register-and-broadcast-node  (to any existing node, typically RegAuth)
              │
              ├─► POST /api/network/register-node  → Peer1
              ├─► POST /api/network/register-node  → Peer2
              │         (tells each existing peer about the new node)
              │
              └─► POST /api/network/register-nodes-bulk  → New node
                        (gives the new node the full peer list)
```

After this handshake, every node in the network knows every other node.

---

## Health Endpoints (also in `routes/network.js` Section 3)

### `GET /api/network/health`
Returns `{ status: 'online', nodeUrl, timestamp }`. Pinged by the heartbeat monitor.

### `GET /api/network/regauth-status`
Returns `{ isRegAuthOnline, lastCheck, pendingBroadcastCount, regAuthUrl }`. Used by frontends to show RegAuth connectivity.
