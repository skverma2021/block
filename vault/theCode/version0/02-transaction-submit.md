# 02 — Transaction Submit (client-originated)

## Purpose
`POST /api/transactions/submit` is how a monitoring station (or Postman) introduces a new environmental reading into the network. The receiving node assigns the identity fields, hashes the data, inserts it into its local mempool, and then broadcasts the complete transaction object to all known peers.

## File
[`routes/transactions.js`](../../../routes/transactions.js) — `router.post('/submit', ...)` (~line 85)

---

## Request

```http
POST /api/transactions/submit
Content-Type: application/json

{
  "projId":    "1",
  "stationId": "station-alpha",
  "rawData": {
    "SO2":   12.4,
    "NO2":   38.1,
    "PM10":  22.0,
    "PM2_5": 11.5
  }
}
```

`rawData` is immediately serialised to a JSON string (`rawDataJson`) and stored as text. The original object shape is preserved exactly, so the hash can be re-verified later.

---

## Processing Steps

```
1. db.createTransaction(rawTransactionData)
      → Generates transactionId (UUID v4), timestamp (ISO 8601), rawDataJson
      → rowHash = SHA-256(transactionId + timestamp + rawDataJson)
      → INSERT INTO mempool_transactions
      → Returns the complete transaction object

2. For each URL in network.networkNodes[]:
      axios.post(`${url}/transactions/receive`, newTransaction, { timeout: BROADCAST_TIMEOUT_MS })
      ← ⚠️ BUG-1: missing '/api' prefix — peers never receive the transaction

3. If any broadcast fails:
      network.addToPendingBroadcasts(newTransaction, failedUrls)
      → Added to in-memory retry queue for when RegAuth comes back online

4. Respond 201 regardless of broadcast outcome
      → Local mempool insert is the source of truth
      → broadcastStatus included in response for transparency
```

---

## Response (`201 Created`)

```json
{
  "note": "Transaction created locally and broadcast successfully.",
  "transaction": {
    "transactionId": "uuid-v4...",
    "projId":        "1",
    "stationId":     "station-alpha",
    "timestamp":     "2026-05-27T10:00:00.000Z",
    "rawData":       { "SO2": 12.4, "NO2": 38.1, "PM10": 22.0, "PM2_5": 11.5 },
    "rawDataJson":   "{\"SO2\":12.4,\"NO2\":38.1,\"PM10\":22.0,\"PM2_5\":11.5}",
    "rowHash":       "sha256hex..."
  },
  "broadcastStatus": {
    "total":       2,
    "success":     0,
    "failed":      2,
    "pendingRetry": true
  }
}
```

If broadcast fails, `note` changes to `"Transaction created locally. 0/2 broadcasts succeeded. 2 queued for retry."` — but the HTTP status is still `201` because the local insert succeeded.

---

## Error Cases

| Condition | HTTP | Detail |
|---|---|---|
| Local DB insert fails | `500` | Returned in `error` field |
| Broadcast fails | `201` (still) | Queued for retry; `broadcastStatus.pendingRetry = true` |

---

## rowHash Formula

```
rowHash = SHA-256( transactionId + timestamp + rawDataJson )
```

Computed in `db.js` — `createTransaction()`. The `rawDataJson` is the deterministic JSON serialisation of the `rawData` object. **The exact string** is stored and used verbatim for all future re-verification.

---

## Key Files

| File | Role |
|---|---|
| [`routes/transactions.js`](../../../routes/transactions.js) | Route handler — orchestration |
| [`db.js`](../../../db.js) — `createTransaction()` | Generates ID, timestamp, hash; inserts into mempool |
| [`routes/network.js`](../../../routes/network.js) — `networkNodes` | Peer list used for broadcast |
| [`routes/network.js`](../../../routes/network.js) — `addToPendingBroadcasts()` | Retry queue |
| [`config.js`](../../../config.js) — `BROADCAST_TIMEOUT_MS` | Axios timeout (5 s) |

---

## Known Issues
- **BUG-1**: Broadcast URL `${url}/transactions/receive` should be `${url}/api/transactions/receive`. Peers currently receive a `404` for every broadcast.
- **QW-1**: `uuidv4()` in `db.createTransaction()` should be `uuidv7()` for time-ordered IDs.
