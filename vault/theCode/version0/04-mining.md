# 04 — PoA Mining & Block Creation

## Purpose
RegAuth is the sole miner. When the mempool reaches `TRANSACTIONS_PER_BLOCK` (5) pending transactions, `mineBlockInternal()` dequeues them, builds a block, hashes it, persists it locally, and broadcasts it to all peer nodes.

## Files
- [`routes/blocks.js`](../../../routes/blocks.js) — `calculateMerkleRoot()` (Section 1), `mineBlockInternal()` (Section 2)
- [`index.js`](../../../index.js) — `setInterval` trigger (~line 286)
- [`config.js`](../../../config.js) — `TRANSACTIONS_PER_BLOCK`, `MINE_CHECK_INTERVAL_MS`

---

## When Mining is Triggered

Two paths, same function:

| Trigger | Location |
|---|---|
| Automatic — interval check | `index.js` → `setInterval(mineBlockInternal, MINE_CHECK_INTERVAL_MS)` when `mempoolCount >= TRANSACTIONS_PER_BLOCK` |
| Manual — HTTP call | `POST /api/blocks/mine` → `mineBlockInternal()` immediately |

Only RegAuth (`REG_AUTH_ID === '0'`) starts the mining interval.

---

## `calculateMerkleRoot(transactions)`

**`routes/blocks.js` Section 1 (~line 29)**

Builds a binary Merkle tree from the `rowHash` values of the transactions:

```
Leaves:  [ rowHash₁, rowHash₂, rowHash₃, rowHash₄, rowHash₅ ]
                                                        ↑ duplicated if odd count

Level 1: [ SHA-256(h₁+h₂), SHA-256(h₃+h₄), SHA-256(h₅+h₅) ]
Level 2: [ SHA-256(l₁+l₂), SHA-256(l₃+l₃) ]
Root:    [ SHA-256(r₁+r₂) ]
```

Empty block edge case: returns `SHA-256('empty_merkle_root_placeholder')`.

---

## `mineBlockInternal()` — Step by Step

**`routes/blocks.js` Section 2 (~line 62)**

```
1. getMempoolCount() — abort if count < TRANSACTIONS_PER_BLOCK

2. getTransactionsForBlock(BLOCK_SIZE)
      → Selects oldest BLOCK_SIZE transactions from mempool

3. getLastBlock()
      → Gets previousBlockHash and blockIndex for chaining

4. Build block object:
      blockIndex         = lastBlock.blockIndex + 1
      timestamp          = new Date().toISOString()
      transactions       = full transaction objects from step 2
      merkleRoot         = calculateMerkleRoot(transactions)
      previousBlockHash  = lastBlock.hash  (or '0' for block after genesis)
      nonce              = 0  (PoA — no computational puzzle)
      hash               = ''  (to be filled in step 5)

5. Compute blockHash:
      transactionsForHash = transactions.map(tx => ({ id: tx.transactionId, hash: tx.rowHash }))
      input = blockIndex + timestamp + merkleRoot + previousBlockHash + nonce
              + JSON.stringify(transactionsForHash)
      hash  = SHA-256(input)

6. db.addBlockToBlockchain(newBlock)
      → Atomic SQLite transaction:
           INSERT INTO bchain (blockIndex, timestamp, transactions, nonce, hash, ...)
           INSERT INTO confirmed_transactions for each tx (with blockId FK)

7. db.removeTransactionsFromMempool(confirmedTransactionIds)
      → DELETE FROM mempool_transactions WHERE transactionId IN (...)

8. Broadcast to all peers:
      axios.post(`${networkNodeUrl}/blocks/receive`, { newBlock })
      ← ⚠️ BUG-1: missing '/api' — peers receive 404, never add the block
```

---

## Block Hash Formula

```
SHA-256(
  blockIndex
  + timestamp
  + merkleRoot
  + previousBlockHash
  + nonce
  + JSON.stringify([{ id: transactionId, hash: rowHash }, ...])
)
```

Only the `(id, hash)` pairs from each transaction are included in the block hash — not the full transaction data. Full data is protected by each transaction's individual `rowHash`.

---

## Nonce

Always `0` for PoA. There is no difficulty target and no computational race. RegAuth mines by authority, not by CPU work.

---

## POST /api/blocks/mine

```http
POST /api/blocks/mine
```

No body required. Calls `mineBlockInternal()` synchronously and returns its result. Returns `400`-class if mempool is below threshold; `500` on any internal error.

---

## Known Issues
- **BUG-1** (`routes/blocks.js` line ~139): Broadcast URL `${networkNodeUrl}/blocks/receive` is missing `/api`. Fix: `${networkNodeUrl}/api/blocks/receive`. This is the most critical bug — without it, mined blocks never reach project nodes.
