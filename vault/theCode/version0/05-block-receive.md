# 05 — Block Receive & Validation

## Purpose
`POST /api/blocks/receive` is called on project nodes when RegAuth broadcasts a newly mined block. The receiving node runs a gauntlet of validation checks before accepting the block into its local chain. Any failure results in a rejection without state change.

## File
[`routes/blocks.js`](../../../routes/blocks.js) — `router.post('/receive', ...)` Section 3 (~line 160)

---

## Who calls this?
`mineBlockInternal()` in `routes/blocks.js` after mining — broadcasts to all URLs in `network.networkNodes[]`.

> **BUG-1 note**: the broadcast currently uses the wrong URL path (`/blocks/receive` instead of `/api/blocks/receive`), so in practice this endpoint is never reached by peers until the bug is fixed.

---

## Request

```json
{
  "newBlock": {
    "blockIndex":        1,
    "timestamp":         "2026-05-27T10:05:00.000Z",
    "transactions":      [ { ...full transaction objects... } ],
    "merkleRoot":        "sha256hex...",
    "previousBlockHash": "sha256hex...",
    "nonce":             0,
    "hash":              "sha256hex..."
  }
}
```

---

## Validation Gauntlet

```
Check 1: Mandatory fields
  → newBlock, blockIndex, timestamp, transactions, merkleRoot, previousBlockHash, hash
  → Missing → 400

Check 2: Block already on chain?
  → newBlock.blockIndex <= lastLocalBlockIndex → 200 "Block already on chain, ignoring"

Check 3: Sequential index
  → newBlock.blockIndex !== lastLocalBlockIndex + 1 → 400 "Block index not sequential"

Check 4: previousBlockHash links correctly
  → newBlock.previousBlockHash !== lastLocalBlock.hash → 400 "Previous hash mismatch"

Check 5: Block hash re-computation
  → Re-derive SHA-256(blockIndex + timestamp + merkleRoot + previousBlockHash
                      + nonce + JSON([{id, hash}...]))
  → Mismatch → 400 "Block hash mismatch"

Check 6: Merkle root re-computation
  → Recompute calculateMerkleRoot(newBlock.transactions)
  → Mismatch → 400 "Merkle root mismatch"

All checks pass:
  → db.addBlockToBlockchain(newBlock)  — atomic insert (bchain + confirmed_transactions)
  → db.removeTransactionsFromMempool(confirmedTransactionIds)
  → 200 "Block accepted and added to blockchain"
```

---

## Why 6 checks?

| Check | Protects against |
|---|---|
| 1. Mandatory fields | Malformed requests |
| 2. Already on chain | Duplicate broadcasts (e.g. restart replay) |
| 3. Sequential index | Gap in chain — node missed a block |
| 4. Previous hash | Chain fork — received block doesn't attach to our tip |
| 5. Block hash | RegAuth broadcasting a tampered block |
| 6. Merkle root | Individual transaction tampering within a valid-looking block |

---

## Response

`200 OK` on acceptance:
```json
{ "note": "Block accepted and added to blockchain.", "block": { ... } }
```

`200 OK` on duplicate (already on chain):
```json
{ "note": "Block already on chain or older, ignoring." }
```

`400 Bad Request` on any validation failure — with a descriptive `note` field.

---

## Chain Query Endpoints (also in Section 3)

### `GET /api/blocks`
Returns the full blockchain array. Each block includes its full `transactions` array.

### `GET /api/blocks/chain`
Returns `{ chain: [...] }` — used by startup sync and force resync.

### `GET /api/blocks/last-index`
Returns `{ lastBlockIndex: N }` — used during startup sync to compare heights.

### `GET /api/blocks/chain-from/:index`
Returns all blocks after the given index — used for partial sync.

### `GET /api/blocks/chain-hash`
Returns `{ chainHash, blockCount }` — used by the integrity check to compare against RegAuth.
