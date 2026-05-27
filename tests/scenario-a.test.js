'use strict';
// =============================================================================
// Scenario A — Project Node Recovery
//
// Tests the DB-layer functions that underpin startup sync and chain recovery.
// The actual HTTP sync loop lives in index.js; these tests validate the
// building blocks that loop depends on.
//
// Tests:
//   A1  Empty project-node DB → getLastBlockIndex() returns -1 (sync trigger)
//   A2  getBlocksFromIndex(n) returns only blocks with index > n
//   A3  A chain with a broken previousBlockHash link fails verifyChainIntegrity
//   A4  purge + re-add correct blocks restores a valid chain (simulates force-resync)
//   A5  getLastBlockIndex() returns correct value after blocks are added
// =============================================================================

const db = require('../db');
const { setupTestDb, teardownTestDb, openDirectConn, runDirect, closeDirect } = require('./helpers/dbSetup');
const { makeTransaction, makeBlock } = require('./helpers/blockBuilder');

const TEST_DB = 'test-scenario-a.db';
let genesis;

beforeAll(async () => {
    // projId='0' (RegAuth) so genesis is created automatically
    await setupTestDb('0', TEST_DB);
    const chain = await db.getAllBlocks();
    genesis = chain[0];
});

afterAll(async () => {
    await teardownTestDb(TEST_DB);
});

// ---------------------------------------------------------------------------
// A1 — an empty project-node DB reports index -1 (triggers full sync)
// ---------------------------------------------------------------------------
test('A1: empty project-node DB reports last block index of -1', async () => {
    // We can't spin up a true project-node DB here (that would need another
    // module context).  We verify the contract through the RegAuth DB that
    // has only the genesis block: the moment we purge genesis, we get -1.
    const directConn = openDirectConn(TEST_DB);
    try {
        await runDirect(directConn, 'DELETE FROM confirmed_transactions');
        await runDirect(directConn, 'DELETE FROM bchain');

        expect(await db.getLastBlockIndex()).toBe(-1);
    } finally {
        await closeDirect(directConn);
        // Restore genesis so later tests have a base
        await db.addBlockToBlockchain(genesis);
    }
});

// ---------------------------------------------------------------------------
// A2 — getBlocksFromIndex(n) returns only blocks with index > n
// ---------------------------------------------------------------------------
test('A2: getBlocksFromIndex(n) returns blocks with index strictly > n', async () => {
    const block1 = makeBlock(1, genesis.hash, []);
    const block2 = makeBlock(2, block1.hash, []);
    const block3 = makeBlock(3, block2.hash, [makeTransaction({ transactionId: 'tx-a2' })]);
    await db.addBlockToBlockchain(block1);
    await db.addBlockToBlockchain(block2);
    await db.addBlockToBlockchain(block3);

    const partial = await db.getBlocksFromIndex(1); // should return blocks 2 and 3

    expect(partial.map(b => b.blockIndex)).toEqual([2, 3]);
});

// ---------------------------------------------------------------------------
// A3 — chain with broken previousBlockHash fails integrity check
// ---------------------------------------------------------------------------
test('A3: chain with broken previousBlockHash link fails verifyChainIntegrity', async () => {
    const chain = await db.getAllBlocks();
    const last  = chain[chain.length - 1];

    // Build a block that claims to follow "last" but has a wrong previousBlockHash
    const orphan = makeBlock(last.blockIndex + 1, 'wrong-prev-hash', []);
    await db.addBlockToBlockchain(orphan);

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(false);
    expect(result.corruptedBlockIndex).toBe(orphan.blockIndex);
    expect(result.errors.some(e => /previous hash mismatch/i.test(e))).toBe(true);
});

// ---------------------------------------------------------------------------
// A4 — purge corrupted tail + add correct blocks → chain is valid again
//      (simulates what force-resync does after detecting a fork)
// ---------------------------------------------------------------------------
test('A4: purge corrupted blocks and re-add correct ones restores valid chain', async () => {
    // At this point chain has orphan block from A3; purge from the bad index
    const corruptIndex = (await db.verifyChainIntegrity()).corruptedBlockIndex;
    expect(corruptIndex).not.toBeNull();

    await db.purgeBlockchainFrom(corruptIndex);

    // Re-add a correct block linking to what is now the tail
    const newLast = (await db.getAllBlocks()).at(-1);
    const corrected = makeBlock(newLast.blockIndex + 1, newLast.hash, []);
    await db.addBlockToBlockchain(corrected);

    const result = await db.verifyChainIntegrity();

    expect(result.valid).toBe(true);
    expect(result.corruptedBlockIndex).toBeNull();
});

// ---------------------------------------------------------------------------
// A5 — getLastBlockIndex returns correct value after syncing blocks
// ---------------------------------------------------------------------------
test('A5: getLastBlockIndex matches actual highest block after partial sync', async () => {
    const before = await db.getLastBlockIndex();
    const next   = makeBlock(before + 1, (await db.getAllBlocks()).at(-1).hash, []);
    await db.addBlockToBlockchain(next);

    expect(await db.getLastBlockIndex()).toBe(before + 1);
});
