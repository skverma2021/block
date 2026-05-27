'use strict';
// =============================================================================
// Test helper: builds valid block and transaction objects with correct hashes.
// Mirrors the hashing formulas in db.js exactly — if the formulas diverge,
// the tests will catch it.
// =============================================================================

const crypto = require('crypto');

/**
 * Build a transaction with a correct rowHash.
 * Any field can be overridden; rowHash is re-derived from the final values
 * unless explicitly overridden (e.g. to test tamper detection).
 */
function makeTransaction(overrides = {}) {
    const transactionId = overrides.transactionId
        ?? ('tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    const timestamp  = overrides.timestamp  ?? new Date().toISOString();
    const rawDataJson = overrides.rawDataJson
        ?? JSON.stringify({ SO2: 10, NO2: 5, PM10: 20, PM2_5: 15 });

    const rowHash = overrides.rowHash
        ?? crypto.createHash('sha256').update(transactionId + timestamp + rawDataJson).digest('hex');

    return {
        transactionId,
        projId:      overrides.projId      ?? '1',
        timestamp,
        submitterId: overrides.submitterId ?? 'test-submitter',
        stationID:   overrides.stationID   ?? 'STATION-001',
        SO2:         overrides.SO2         ?? 10,
        NO2:         overrides.NO2         ?? 5,
        PM10:        overrides.PM10        ?? 20,
        PM2_5:       overrides.PM2_5       ?? 15,
        rawDataJson,
        rowHash,
    };
}

/** Mirrors calculateMerkleRoot in db.js exactly. */
function calculateMerkleRoot(transactions) {
    if (!transactions || transactions.length === 0) {
        return crypto.createHash('sha256').update('empty_merkle_root_placeholder').digest('hex');
    }
    let hashes = transactions.map(tx => tx.rowHash);
    while (hashes.length > 1) {
        if (hashes.length % 2 !== 0) hashes.push(hashes[hashes.length - 1]);
        const newHashes = [];
        for (let i = 0; i < hashes.length; i += 2) {
            newHashes.push(crypto.createHash('sha256').update(hashes[i] + hashes[i + 1]).digest('hex'));
        }
        hashes = newHashes;
    }
    return hashes[0];
}

/**
 * Build a block with a correct hash and merkleRoot.
 * @param {number}   blockIndex
 * @param {string}   previousBlockHash
 * @param {object[]} transactions - array of transaction objects from makeTransaction()
 */
function makeBlock(blockIndex, previousBlockHash, transactions = []) {
    const timestamp  = new Date().toISOString();
    const merkleRoot = calculateMerkleRoot(transactions);
    const txForHash  = transactions.map(tx => ({ id: tx.transactionId, hash: tx.rowHash }));
    const hash = crypto
        .createHash('sha256')
        .update(blockIndex + timestamp + merkleRoot + previousBlockHash + 0 + JSON.stringify(txForHash))
        .digest('hex');

    return { blockIndex, timestamp, transactions, nonce: 0, hash, previousBlockHash, merkleRoot };
}

module.exports = { makeTransaction, makeBlock, calculateMerkleRoot };
