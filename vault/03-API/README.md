# 03 — API

All routes are mounted under `/api`. All request/response bodies are JSON.

---

## Network Routes (`routes/network.js`)

### `GET /api/network/health`
Returns `200 OK` with basic node health info.

### `GET /api/network/status`
Returns full node status: node URL, projId, registered peers, mempool count, chain length.

### `POST /api/network/register-node`
Register a single node with this node.  
**Body**: `{ "nodeUrl": "http://localhost:3001" }`

### `POST /api/network/register-and-broadcast-node`
Register a node AND broadcast the registration to all known peers (used by a new node joining the network).  
**Body**: `{ "nodeUrl": "http://localhost:3001" }`

### `POST /api/network/register-nodes-bulk`
Register multiple nodes at once (called during the broadcast phase of join).  
**Body**: `{ "allNetworkNodes": ["http://localhost:3001", "http://localhost:3002"] }`

---

## Transaction Routes (`routes/transactions.js`)

### `GET /api/transactions`
Returns all confirmed (mined) transactions, ordered by timestamp descending.

### `POST /api/transactions/submit`
Submit a new environmental reading. Creates a transaction in the local mempool and broadcasts to all peers.  
**Body**:
```json
{
  "projId": "1",
  "stationId": "station-alpha",
  "rawData": {
    "SO2": 12.4,
    "NO2": 38.1,
    "PM10": 22.0,
    "PM2_5": 11.5
  }
}
```
**Response** (`201`): Full transaction object including `transactionId`, `timestamp`, `rowHash`.

### `POST /api/transactions/receive`
Internal peer-to-peer endpoint. Receives a transaction broadcast from another node.  
**Body**: Full transaction object (same shape as the response from `/submit`).

---

## Block Routes (`routes/blocks.js`)

### `GET /api/blocks`
Returns the full blockchain (array of blocks, each with embedded transactions).

### `POST /api/blocks/mine`
**RegAuth only.** Triggers an immediate mining attempt regardless of mempool size.  
No body required.

### `POST /api/blocks/receive`
Internal peer-to-peer endpoint. Receives a mined block broadcast from RegAuth.  
**Body**: Full block object.

---

## Error Codes

| HTTP | Meaning |
|---|---|
| `400` | Missing or invalid request body fields |
| `409` | Duplicate transaction (already in mempool or confirmed) |
| `500` | Internal error — check node console for stack trace |

---

## Known Bugs (Version 0)

> See `05-Dev/README.md` for the full bug register.

**BUG-1**: All `axios.post` calls in the route files are missing the `/api` prefix — blocks and transactions are never received by peers. Fix: prepend `/api` to all inter-node POST URLs.

**BUG-2**: Transaction retry flush (`flushPendingBroadcasts`) also uses the wrong URL path.

---

## Postman Quick-Start

1. Start RegAuth: `node index.js 3000 http://localhost:3000 0 regauth.db`
2. Start ProjA: `node index.js 3001 http://localhost:3001 1 proja.db`
3. Register ProjA with RegAuth:  
   `POST http://localhost:3000/api/network/register-and-broadcast-node`  
   `{ "nodeUrl": "http://localhost:3001" }`
4. Submit 5 transactions to ProjA (will trigger mining on RegAuth after ~10 s).
5. Check chain on both nodes:  
   `GET http://localhost:3000/api/blocks`  
   `GET http://localhost:3001/api/blocks`
