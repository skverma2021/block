# 08 — Heartbeat & Pending Broadcast Retry

## Purpose
Project nodes need to know when RegAuth is unreachable so they can queue failed transaction broadcasts and flush the queue when RegAuth comes back online. This prevents transactions from being permanently lost when the network is temporarily partitioned.

## File
[`routes/network.js`](../../../routes/network.js) — Section 4 (~lines 77–165)

---

## State Variables

```js
let isRegAuthOnline   = true;   // Current availability flag
let lastRegAuthCheck  = null;   // ISO timestamp of last check
let pendingBroadcasts = [];     // In-memory retry queue
// [{ transaction, targetUrls, attempts, lastAttempt }, ...]
```

> **TODO PF-1**: `pendingBroadcasts` lives in memory only. A node restart loses the queue. Fix: persist to a `pending_broadcasts` SQLite table.

---

## `checkRegAuthHealth()`

**Called by**: heartbeat `setInterval` in `index.js` (~line 310), and once immediately on startup.

```
GET /api/network/health from REG_AUTH_URL (http://localhost:3000)
  timeout: 5 000 ms

Success (status 200):
    wasOffline = !isRegAuthOnline
    isRegAuthOnline = true
    lastRegAuthCheck = now

    If wasOffline:
        → "RegAuth is back ONLINE!"
        → flushPendingBroadcasts()   ← drain the retry queue

    return true

Failure (any error):
    If was previously online → log "RegAuth appears to be OFFLINE"
    isRegAuthOnline = false
    return false
```

**Heartbeat interval**: every `HEARTBEAT_INTERVAL_MS` (30 s) — only on project nodes (`REG_AUTH_ID !== '0'`).

---

## `addToPendingBroadcasts(transaction, targetUrls)`

Called from `routes/transactions.js` `/submit` when one or more peer broadcasts fail.

```js
// Deduplication guard — don't add the same transaction twice
const exists = pendingBroadcasts.some(p => p.transaction.transactionId === transaction.transactionId);
if (!exists) {
    pendingBroadcasts.push({ transaction, targetUrls, attempts: 0, lastAttempt: null });
}
```

Only the *failed* `targetUrls` are queued — successful broadcasts are not retried.

---

## `flushPendingBroadcasts()`

Called automatically when RegAuth comes back online (detected in `checkRegAuthHealth()`).

```
If queue is empty → return immediately

Copy queue to toRetry[], clear queue

For each pending item:
    pending.attempts++
    pending.lastAttempt = now

    Promise.all: POST /transactions/receive to each targetUrl
        ← ⚠️ BUG-2: URL missing '/api' — retries also fail with 404
        Failures caught individually and logged (do not abort the flush)

    If outer try/catch fires (unexpected error):
        If attempts < MAX_BROADCAST_RETRIES (5):
            Re-add to pendingBroadcasts[]
        Else:
            "Giving up on transaction X after N attempts"
```

> **BUG-2** detail: `${url}/transactions/receive` should be `${url}/api/transactions/receive`. Same root cause as BUG-1.

---

## Retry Lifecycle Diagram

```
/submit fails to reach ProjB
    │
    └─► addToPendingBroadcasts(tx, ['http://localhost:3002'])
              pendingBroadcasts = [{ tx, ['projB'], attempts: 0 }]

... RegAuth goes offline, heartbeat fails ...
    isRegAuthOnline = false
    (new transactions still accepted locally, broadcasts queued)

... RegAuth comes back online ...
    checkRegAuthHealth() → 200
    wasOffline = true
    → flushPendingBroadcasts()
              → POST /api/transactions/receive to projB  (after BUG-2 fix)
              → Success: queue item removed
```

---

## `GET /api/network/regauth-status`

Frontend-readable summary of heartbeat state:

```json
{
  "isRegAuthOnline":       true,
  "lastCheck":             "2026-05-27T10:30:00.000Z",
  "pendingBroadcastCount": 3,
  "regAuthUrl":            "http://localhost:3000"
}
```

---

## Known Issues

| ID | Location | Description |
|---|---|---|
| **BUG-2** | `flushPendingBroadcasts` (~line 150) | Retry URL missing `/api` prefix — retries always return 404 |
| **BUG-4** | Module-level `const REG_AUTH_URL` (~line 34) | Hardcoded to `http://localhost:3000` — same issue as in `index.js` |
| **PF-1** | `pendingBroadcasts = []` | In-memory only — lost on restart. Fix: persist to SQLite |
| **BUG-3** | `module.exports` | `myNodeUrl` exported as snapshot value (always `''`). Fix: use a getter |
