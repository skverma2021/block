# 06 — Startup Chain Synchronisation

## Purpose
When a project node starts, it may be behind RegAuth — either because it's brand new (no blocks at all) or because it was offline and missed some blocks. The startup sync in `startServer()` brings it up to date before the node begins accepting requests.

## File
[`index.js`](../../../index.js) — inside `async function startServer()`, after `db.initDb()` (~lines 205–280)

Only runs when `REG_AUTH_ID !== '0'` (i.e. not RegAuth itself).

---

## Sync Decision Tree

```
getLastBlockIndex() → localLastIndex
GET /api/blocks/last-index from RegAuth → regAuthLastIndex

localLastIndex === regAuthLastIndex
    → "Up to date." No sync needed.

localLastIndex < regAuthLastIndex

    localLastIndex === -1  (no local blocks at all)
        → FULL SYNC
        → GET /api/blocks/chain from RegAuth
        → addBlockToBlockchain(block) for every block
        → removeTransactionsFromMempool(block.txIds) for every block

    localLastIndex > -1  (node was down, missed some blocks)
        → PARTIAL SYNC
        → GET /api/blocks/chain-from/${localLastIndex} from RegAuth
        → Validate chain continuity:
              for each missing block:
                  block.previousBlockHash === previousHash?  No → FORK
        → Chain valid:
              addBlockToBlockchain + removeTransactionsFromMempool for each
        → Chain fork detected:
              logTamperingAlert('CHAIN_FORK_DETECTED', ...)
              forceResyncFromRegAuth()  ← full purge and re-download

localLastIndex > regAuthLastIndex
    → Log warning: "Local chain AHEAD of RegAuth — unexpected in PoA"
    → No action taken
```

---

## Full Sync Path

Triggered when `localLastIndex === -1` (fresh node, no data).

```js
GET /api/blocks/chain  →  { chain: [...all blocks...] }

for (const block of fullChain) {
    await db.addBlockToBlockchain(block);
    await db.removeTransactionsFromMempool(block.transactions.map(tx => tx.transactionId));
}
```

---

## Partial Sync Path

Triggered when node was offline and missed some blocks.

```js
GET /api/blocks/chain-from/${localLastIndex}  →  { blocks: [...missed blocks...] }

// Validate continuity
let previousHash = localLastBlock.hash;
for (const block of missingBlocks) {
    if (block.previousBlockHash !== previousHash) → FORK → forceResync
    previousHash = block.hash;
}

// Add each missing block
for (const block of missingBlocks) {
    await db.addBlockToBlockchain(block);
    await db.removeTransactionsFromMempool(...);
}
```

---

## `forceResyncFromRegAuth()` (Section 3, ~line 80)

Invoked when a chain fork is detected during partial sync, or when the periodic integrity check finds a hash mismatch.

```
1. db.purgeEntireBlockchain()   ← wipes bchain + confirmed_transactions
2. GET /api/blocks/chain        ← fetches full chain from RegAuth
3. addBlockToBlockchain(block)  ← rebuilds chain locally
4. db.verifyChainIntegrity()    ← confirms the rebuilt chain is valid
5. logTamperingAlert on failure
```

---

## Error Handling

If RegAuth is unreachable during startup sync, the error is caught and logged — but the node continues booting. It will be out of sync until the periodic integrity check or next restart triggers a resync.

---

## Key DB Functions Involved

| Function | File | Purpose |
|---|---|---|
| `db.getLastBlockIndex()` | `db.js` | Returns the highest `blockIndex` stored locally, or `-1` |
| `db.getLastBlock()` | `db.js` | Returns the full last block object |
| `db.addBlockToBlockchain()` | `db.js` | Atomic insert: `bchain` + `confirmed_transactions` |
| `db.removeTransactionsFromMempool()` | `db.js` | Clears mempool of confirmed tx IDs |
| `db.purgeEntireBlockchain()` | `db.js` | Hard wipe for force resync |
| `db.verifyChainIntegrity()` | `db.js` | Post-resync validation |
