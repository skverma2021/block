# 03 — Transaction Receive (peer-broadcast)

## Purpose
`POST /api/transactions/receive` accepts a transaction that was already created and hashed on another node. The receiving node re-validates the hash independently before inserting into its local mempool — this is the tamper-check at the network boundary.

## File
[`routes/transactions.js`](../../../routes/transactions.js) — `router.post('/receive', ...)` (~line 33)

---

## Who calls this?
- `routes/transactions.js` — `/submit` broadcasts to all peers after local insert.
- `routes/network.js` — `flushPendingBroadcasts()` retries queued broadcasts.

It is **not** intended to be called directly by clients. The transaction must already have `transactionId`, `timestamp`, `rowHash`, and `rawDataJson`.

---

## Request

The full transaction object as returned by `/submit`:

```json
{
  "transactionId": "uuid-v4...",
  "projId":        "1",
  "stationId":     "station-alpha",
  "timestamp":     "2026-05-27T10:00:00.000Z",
  "rawData":       { "SO2": 12.4, ... },
  "rawDataJson":   "{\"SO2\":12.4,...}",
  "rowHash":       "sha256hex..."
}
```

---

## Validation Steps

```
Check 1: Mandatory fields present?
  → transactionId, timestamp, rowHash, rawDataJson, projId
  → Missing → 400

Check 2: Hash re-validation
  → dataToHash = transactionId + timestamp + rawDataJson
  → reCalculatedHash = SHA-256(dataToHash)
  → reCalculatedHash !== rowHash → 400 "Transaction hash mismatch"
  → Match → proceed

Insert: db.createTransaction(transactionData)
  → Uses the provided transactionId/timestamp/rowHash as-is (does not regenerate)
  → INSERT INTO mempool_transactions
  → Duplicate → caught → 409
```

---

## Response

`201 Created`:
```json
{
  "message": "Transaction received and accepted into mempool.",
  "transaction": { ... }
}
```

---

## Error Cases

| Condition | HTTP | Detail |
|---|---|---|
| Missing mandatory field | `400` | Lists missing field in message |
| Hash mismatch | `400` | `"Transaction hash mismatch. Data may be corrupted."` |
| Duplicate `transactionId` | `409` | SQLITE UNIQUE constraint caught explicitly |
| Other DB error | `500` | Generic error message |

---

## Why re-validate the hash?
Each receiving node is an independent auditor. A compromised originating node could modify the `rawData` in transit. Re-deriving `SHA-256(transactionId + timestamp + rawDataJson)` locally ensures the data is identical to what was hashed at source — any modification breaks the hash and the transaction is rejected.

---

## Key Files

| File | Role |
|---|---|
| [`routes/transactions.js`](../../../routes/transactions.js) | Route handler and hash re-validation logic |
| [`db.js`](../../../db.js) — `createTransaction()` | Inserts with provided IDs (no regeneration when fields already present) |
