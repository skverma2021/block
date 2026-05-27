# 07 — Periodic Integrity Verification

## Purpose
Every node independently re-derives all hashes in its local chain on a timer. If any hash doesn't match, the node knows something was altered. Project nodes also compare their rolling chain hash against RegAuth's authoritative value to catch divergence that local re-derivation alone wouldn't detect (e.g. an entire replaced block with a recalculated hash).

## Files
- [`index.js`](../../../index.js) — `performIntegrityCheck()` (Section 4, ~line 130), interval setup (~line 330)
- [`db.js`](../../../db.js) — `verifyChainIntegrity()`, `calculateChainHash()`, `logTamperingAlert()`

Runs on **all nodes** every `INTEGRITY_CHECK_INTERVAL_MS` (5 minutes, from [`config.js`](../../../config.js)).

---

## `performIntegrityCheck()` — Step by Step

**`index.js` Section 4**

```
Step 1: Local chain integrity
  → db.verifyChainIntegrity()
      Recomputes:
        - rowHash for every confirmed transaction
        - blockHash for every block
        - Merkle root for every block
      Returns: { valid: bool, corruptedBlockIndex?: number }

  If NOT valid:
      → Log "LOCAL CHAIN CORRUPTION DETECTED at block N"
      → forceResyncFromRegAuth()
      → Return (don't proceed to step 2)

Step 2: Cross-check with RegAuth  (project nodes only, REG_AUTH_ID !== '0')
  → db.calculateChainHash()
      → Returns { chainHash, blockCount } — a rolling SHA-256 over all block hashes
  → GET /api/blocks/chain-hash from RegAuth
      → Returns { chainHash, blockCount }

  If blockCounts match AND chainHashes differ:
      → db.logTamperingAlert('CHAIN_HASH_MISMATCH', 'CRITICAL', ...)
      → forceResyncFromRegAuth()

  If localBlockCount < regAuthBlockCount:
      → "Local chain behind RegAuth. Will sync on next heartbeat."
      (Catch-up happens at next startup or explicit sync — no immediate resync here)

  If hashes match:
      → "Chain hash matches RegAuth. All good!"
```

---

## `db.verifyChainIntegrity()` — What it checks

**`db.js` Section 5**

For every block in the chain (ordered by `blockIndex`):

1. **Transaction rowHash** — re-derives `SHA-256(transactionId + timestamp + rawDataJson)` for each confirmed transaction and compares to the stored `rowHash`.
2. **Block Merkle root** — recomputes the Merkle tree from the stored transaction `rowHash` values and compares to `block.merkleRoot`.
3. **Block hash** — re-derives the full block hash from all header fields and compares to `block.hash`.
4. **Chain linkage** — checks that `block.previousBlockHash === previousBlock.hash`.

Returns `{ valid: true }` if everything checks out, or `{ valid: false, corruptedBlockIndex: N }` on first failure.

---

## `db.calculateChainHash()`

**`db.js` Section 5**

A rolling hash over all block hashes in sequence:

```
chainHash = SHA-256(block[0].hash + block[1].hash + block[2].hash + ...)
```

This single value acts as a fingerprint for the entire chain. If even one block is altered, the chain hash changes — enabling fast divergence detection between nodes.

---

## Audit Log

When tampering or divergence is detected, an event is written to the `audit_log` table via `db.logTamperingAlert()`:

```sql
INSERT INTO audit_log (timestamp, event_type, details)
VALUES (?, ?, ?)
```

| `event_type` | Trigger |
|---|---|
| `'CHAIN_HASH_MISMATCH'` | Local chain hash differs from RegAuth |
| `'CHAIN_FORK_DETECTED'` | `previousBlockHash` doesn't link during partial sync |
| `'RESYNC_FAILURE'` | `forceResyncFromRegAuth()` failed |

---

## Interval Setup

**`index.js` ~line 330**

```js
integrityCheckInterval = setInterval(async () => {
    await performIntegrityCheck();
}, config.INTEGRITY_CHECK_INTERVAL_MS);  // 300 000 ms = 5 minutes
```

Cleared on `SIGINT` graceful shutdown.

---

## Summary: What each check protects against

| Threat | Detected by |
|---|---|
| Direct SQLite edit on a row | `rowHash` re-derivation |
| Block data altered after mining | Block hash re-derivation |
| Transaction swapped between blocks | Merkle root re-computation |
| Entire block replaced with valid-looking fake | Chain hash cross-check with RegAuth |
| Chain fork / partial sync conflict | `forceResyncFromRegAuth()` |
