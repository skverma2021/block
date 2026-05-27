'use strict';
// =============================================================================
// Scenario C — Tamper Detection and Chain Integrity
//
// Tests:
//   C1  verifyChainIntegrity detects a modified block hash
//   C2  verifyChainIntegrity detects a broken previousBlockHash link
//   C3  verifyChainIntegrity detects a Merkle root mismatch
//   C4  verifyChainIntegrity detects a tampered transaction rowHash
//   C5  verifyChainIntegrity returns the correct corruptedBlockIndex
//   C6  calculateChainHash changes when a block hash is modified
//   C7  purgeBlockchainFrom(n) removes blocks from n onwards, keeps genesis
//   C8  audit_log retains CHAIN_INTEGRITY_FAILURE after purge + rebuild
//   C9  POST /api/blocks/receive rejects a block with an invalid hash (Check-4)
//   C10 POST /api/blocks/receive rejects a block with an invalid Merkle root (Check-5)
// =============================================================================

const request     = require('supertest');
const express     = require('express');
const db          = require('../db');
const { setupTestDb, teardownTestDb, openDirectConn, runDirect, allDirect, closeDirect } = require('./helpers/dbSetup');
const { makeTransaction, makeBlock, calculateMerkleRoot } = require('./helpers/blockBuilder');

const TEST_DB = 'test-scenario-c.db';

// ---------------------------------------------------------------------------
// Shared state — set up once, reset before each test
// ---------------------------------------------------------------------------
let directConn;
let genesis;
let block1;
let tx1, tx2;

beforeAll(async () => {
    await setupTestDb('0', TEST_DB);           // projId='0' → RegAuth → genesis created
    directConn = openDirectConn(TEST_DB);
    const chain = await db.getAllBlocks();
    genesis = chain[0];
});

afterAll(async () => {
    await closeDirect(directConn);
    await teardownTestDb(TEST_DB);
});

/**
 * Before each test: reset the chain to [genesis, block1] and clear the audit_log.
 * This gives each test a deterministic, clean starting state.
 */
beforeEach(async () => {
    // 1. Clear audit_log so test assertions are unambiguous
    await runDirect(directConn, 'DELETE FROM audit_log');
    // 2. Remove all blocks except genesis
    await runDirect(directConn, 'DELETE FROM confirmed_transactions WHERE block_id IN (SELECT id FROM bchain WHERE blockIndex >= 1)');
    await runDirect(directConn, 'DELETE FROM bchain WHERE blockIndex >= 1');
    // 3. Add block 1 with two transactions
    tx1    = makeTransaction({ transactionId: 'tx-c-001' });
    tx2    = makeTransaction({ transactionId: 'tx-c-002' });
    block1 = makeBlock(1, genesis.hash, [tx1, tx2]);
    await db.addBlockToBlockchain(block1);
});

// ---------------------------------------------------------------------------
// C1 — modified block hash is detected
// ---------------------------------------------------------------------------
test('C1: detects modified block hash', async () => {
    await runDirect(directConn,
        'UPDATE bchain SET hash = ? WHERE blockIndex = 1',
        ['000deadbeef000deadbeef000deadbeef000deadbeef000deadbeef000deadbeef']
    );

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /hash mismatch/i.test(e))).toBe(true);
});

// ---------------------------------------------------------------------------
// C2 — broken previousBlockHash link is detected
// ---------------------------------------------------------------------------
test('C2: detects broken previousBlockHash link', async () => {
    await runDirect(directConn,
        'UPDATE bchain SET previousBlockHash = ? WHERE blockIndex = 1',
        ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
    );

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /previous hash mismatch/i.test(e))).toBe(true);
});

// ---------------------------------------------------------------------------
// C3 — Merkle root mismatch is detected
// ---------------------------------------------------------------------------
test('C3: detects Merkle root mismatch', async () => {
    await runDirect(directConn,
        'UPDATE bchain SET merkleRoot = ? WHERE blockIndex = 1',
        ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    );

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /merkle root mismatch/i.test(e))).toBe(true);
});

// ---------------------------------------------------------------------------
// C4 — tampered transaction rowHash is detected
// ---------------------------------------------------------------------------
test('C4: detects tampered transaction rowHash', async () => {
    await runDirect(directConn,
        'UPDATE confirmed_transactions SET rowHash = ? WHERE transaction_id = ?',
        ['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', tx1.transactionId]
    );

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes(tx1.transactionId))).toBe(true);
});

// ---------------------------------------------------------------------------
// C5 — corruptedBlockIndex is correctly identified
// ---------------------------------------------------------------------------
test('C5: identifies corruptedBlockIndex correctly', async () => {
    // Add a second content block (index 2) then corrupt only block 1
    const block2 = makeBlock(2, block1.hash, [makeTransaction({ transactionId: 'tx-c-003' })]);
    await db.addBlockToBlockchain(block2);

    await runDirect(directConn,
        'UPDATE bchain SET hash = ? WHERE blockIndex = 1',
        ['000deadbeef000deadbeef000deadbeef000deadbeef000deadbeef000deadbeef']
    );

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.corruptedBlockIndex).toBe(1);
});

// ---------------------------------------------------------------------------
// C6 — calculateChainHash reflects block changes
// ---------------------------------------------------------------------------
test('C6: calculateChainHash changes when a block hash is modified', async () => {
    const { chainHash: originalHash } = await db.calculateChainHash();

    await runDirect(directConn,
        'UPDATE bchain SET hash = ? WHERE blockIndex = 1',
        ['dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd']
    );

    const { chainHash: tamperedHash } = await db.calculateChainHash();

    expect(originalHash).toBeDefined();
    expect(tamperedHash).toBeDefined();
    expect(originalHash).not.toBe(tamperedHash);
});

// ---------------------------------------------------------------------------
// C7 — purgeBlockchainFrom(n) removes blocks ≥ n; genesis survives
// ---------------------------------------------------------------------------
test('C7: purgeBlockchainFrom(1) removes block 1 but keeps genesis', async () => {
    // Add block 2 to make the purge more meaningful
    const block2 = makeBlock(2, block1.hash, []);
    await db.addBlockToBlockchain(block2);

    expect(await db.getLastBlockIndex()).toBe(2);

    await db.purgeBlockchainFrom(1);

    expect(await db.getLastBlockIndex()).toBe(0);          // genesis survives
    const chain = await db.getAllBlocks();
    expect(chain).toHaveLength(1);
    expect(chain[0].blockIndex).toBe(0);
});

// ---------------------------------------------------------------------------
// C8 — audit_log retains CHAIN_INTEGRITY_FAILURE after purge + rebuild
// ---------------------------------------------------------------------------
test('C8: CHAIN_INTEGRITY_FAILURE alert persists in audit_log after purge and rebuild', async () => {
    // 1. Corrupt block 1 hash → integrity check logs an alert
    await runDirect(directConn,
        'UPDATE bchain SET hash = ? WHERE blockIndex = 1',
        ['eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']
    );
    const corruptResult = await db.verifyChainIntegrity();
    expect(corruptResult.valid).toBe(false);

    // 2. Purge corrupted blocks and rebuild with a valid block
    await db.purgeBlockchainFrom(1);
    const freshBlock1 = makeBlock(1, genesis.hash, [tx1, tx2]);
    await db.addBlockToBlockchain(freshBlock1);

    // 3. Integrity check should now pass
    const cleanResult = await db.verifyChainIntegrity();
    expect(cleanResult.valid).toBe(true);

    // 4. The original CHAIN_INTEGRITY_FAILURE alert must still exist in audit_log
    const alerts = await allDirect(directConn,
        "SELECT * FROM audit_log WHERE event_type = 'CHAIN_INTEGRITY_FAILURE'"
    );
    expect(alerts.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// C9 — POST /api/blocks/receive rejects a block with an invalid hash (Check-4)
// ---------------------------------------------------------------------------
describe('HTTP endpoint — /api/blocks/receive', () => {
    let app;

    beforeAll(() => {
        // Mount only the blocks router; network.myNodeUrl just needs to not throw
        const network = require('../routes/network');
        network.setMyNodeUrl('http://test-node');

        const blocksRouter = require('../routes/blocks');
        app = express();
        app.use(express.json());
        app.use('/api/blocks', blocksRouter.router);
    });

    test('C9: rejects block whose hash does not match content (Check-4)', async () => {
        const chain    = await db.getAllBlocks();
        const lastBlock = chain[chain.length - 1];

        const badBlock = {
            blockIndex:        lastBlock.blockIndex + 1,
            timestamp:         new Date().toISOString(),
            transactions:      [],
            nonce:             0,
            hash:              'badhash0000000000000000000000000000000000000000000000000000000000',
            previousBlockHash: lastBlock.hash,
            merkleRoot:        calculateMerkleRoot([]),
        };

        const res = await request(app)
            .post('/api/blocks/receive')
            .send({ newBlock: badBlock });

        expect(res.status).toBe(400);
        expect(res.body.note).toMatch(/hash mismatch/i);
    });

    test('C10: rejects block whose Merkle root does not match transactions (Check-5)', async () => {
        const chain    = await db.getAllBlocks();
        const lastBlock = chain[chain.length - 1];
        const tx        = makeTransaction({ transactionId: 'tx-c-receive' });

        // Build a valid block then swap in a wrong merkleRoot
        const validBlock  = makeBlock(lastBlock.blockIndex + 1, lastBlock.hash, [tx]);
        const badMerkle   = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

        // Recompute hash with the bad merkleRoot so Check-4 passes but Check-5 fails
        const crypto = require('crypto');
        const txForHash = [tx].map(t => ({ id: t.transactionId, hash: t.rowHash }));
        const rehash = crypto.createHash('sha256')
            .update(validBlock.blockIndex + validBlock.timestamp + badMerkle +
                    validBlock.previousBlockHash + validBlock.nonce + JSON.stringify(txForHash))
            .digest('hex');

        const badBlock = { ...validBlock, merkleRoot: badMerkle, hash: rehash };

        const res = await request(app)
            .post('/api/blocks/receive')
            .send({ newBlock: badBlock });

        expect(res.status).toBe(400);
        expect(res.body.note).toMatch(/merkle root mismatch/i);
    });
});
