'use strict';
// =============================================================================
// Scenario B — RegAuth Unavailability
//
// Tests:
//   B1  checkRegAuthHealth() sets regAuthStatus to false when RegAuth is down
//   B2  addToPendingBroadcasts queues a transaction (dedup prevents duplicates)
//   B3  flushPendingBroadcasts calls axios.post for each queued item on success
//   B4  after MAX_BROADCAST_RETRIES failures the item is dropped permanently
// =============================================================================

jest.mock('axios');

const axios   = require('axios');
const config  = require('../config');
const network = require('../routes/network');
const { makeTransaction } = require('./helpers/blockBuilder');

// Give the module a node URL so log messages don't crash
network.setMyNodeUrl('http://test-node-b');
network.setRegAuthUrl('http://localhost:3000');

// Helper: call flushPendingBroadcasts N times in sequence
async function flushTimes(n) {
    for (let i = 0; i < n; i++) {
        await network.flushPendingBroadcasts();
    }
}

// ---------------------------------------------------------------------------
// B1 — checkRegAuthHealth returns false and updates regAuthStatus
// ---------------------------------------------------------------------------
test('B1: checkRegAuthHealth returns false and marks RegAuth offline when unreachable', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await network.checkRegAuthHealth();

    expect(result).toBe(false);
    expect(network.regAuthStatus).toBe(false);
});

// ---------------------------------------------------------------------------
// B2 — addToPendingBroadcasts queues a transaction; duplicate is ignored
// ---------------------------------------------------------------------------
test('B2: addToPendingBroadcasts queues a transaction and deduplicates', async () => {
    const tx  = makeTransaction({ transactionId: 'tx-b2' });
    const url = 'http://peer-node:3001';

    // Queue the same transaction twice — should appear only once
    network.addToPendingBroadcasts(tx, [url]);
    network.addToPendingBroadcasts(tx, [url]);

    // Verify by flushing: axios.post should be called exactly once
    axios.post.mockResolvedValueOnce({ status: 200 });

    await network.flushPendingBroadcasts();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
        `${url}/api/transactions/receive`,
        tx,
        expect.objectContaining({ timeout: config.BROADCAST_TIMEOUT_MS })
    );
});

// ---------------------------------------------------------------------------
// B3 — flushPendingBroadcasts calls axios.post for every queued item
// ---------------------------------------------------------------------------
test('B3: flushPendingBroadcasts delivers all queued items when RegAuth is online', async () => {
    jest.clearAllMocks();

    const tx1 = makeTransaction({ transactionId: 'tx-b3-a' });
    const tx2 = makeTransaction({ transactionId: 'tx-b3-b' });
    const url  = 'http://peer-node:3001';

    network.addToPendingBroadcasts(tx1, [url]);
    network.addToPendingBroadcasts(tx2, [url]);

    axios.post.mockResolvedValue({ status: 200 });

    await network.flushPendingBroadcasts();

    // One call per transaction
    expect(axios.post).toHaveBeenCalledTimes(2);

    // Queue is empty now — a second flush should be a no-op
    jest.clearAllMocks();
    await network.flushPendingBroadcasts();
    expect(axios.post).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// B4 — item is dropped after MAX_BROADCAST_RETRIES consecutive failures
// ---------------------------------------------------------------------------
test('B4: item is dropped permanently after MAX_BROADCAST_RETRIES failures', async () => {
    jest.clearAllMocks();

    const tx  = makeTransaction({ transactionId: 'tx-b4' });
    const url = 'http://peer-node:3001';

    network.addToPendingBroadcasts(tx, [url]);

    // Every axios.post call fails
    axios.post.mockRejectedValue(new Error('Network error'));

    // Flush MAX_BROADCAST_RETRIES times — item is re-queued on each failure
    await flushTimes(config.MAX_BROADCAST_RETRIES);

    expect(axios.post).toHaveBeenCalledTimes(config.MAX_BROADCAST_RETRIES);

    // One more flush: item should now be gone — no more axios calls
    jest.clearAllMocks();
    await network.flushPendingBroadcasts();
    expect(axios.post).not.toHaveBeenCalled();
});
