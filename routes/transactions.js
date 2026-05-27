// routes/transactions.js
// =============================================================================
// Two entry points for transactions:
//
//   POST /api/transactions/receive  — called by peer nodes to deliver a
//       transaction that was already created and hashed on the originating
//       node. Re-validates the hash before accepting.
//
//   POST /api/transactions/submit   — called by a client (Postman / dashboard)
//       to create a new raw transaction. This node assigns the ID, timestamp,
//       and hash, then broadcasts the complete transaction object to peers.
//
//   GET  /api/transactions          — returns all confirmed transactions.
//
// NOTE BUG-1/2: Inter-node broadcast URLs are missing the '/api' prefix.
//   Fix tracked in VERSION_0_TODO.
// =============================================================================

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const db      = require('../db');
const network = require('./network');
const config  = require('../config');

// ---------------------------------------------------------------------------
// RECEIVE — accepts an already-formed transaction from a peer node.
// ---------------------------------------------------------------------------

// This endpoint is called by peer nodes, not clients.
// The transaction must already have a transactionId, rowHash, and rawDataJson.
router.post('/receive', async (req, res) => {
    console.log(`Node ${network.myNodeUrl}: Received transaction from peer...`);
    try {
        const transactionData = req.body;

        // Validation for a received transaction: It should already have an ID and a hash.
        if (!transactionData.transactionId || !transactionData.timestamp || !transactionData.rowHash || !transactionData.rawDataJson || transactionData.projId === undefined) {
            console.error(`Node ${network.myNodeUrl}: Received transaction is missing mandatory fields (transactionId, timestamp, rowHash, rawDataJson, or projId). Rejecting.`);
            return res.status(400).json({ error: 'Missing mandatory transaction fields for reception.' });
        }
        console.log(`Node ${network.myNodeUrl}: Passed Check-1 (Mandatory fields present)`);

        // Re-validate the hash: Use the exact rawDataJson string that was originally hashed.
        const dataToHash = transactionData.transactionId + transactionData.timestamp + transactionData.rawDataJson;
        const reCalculatedHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

        console.log(`Node ${network.myNodeUrl}: Original rowHash: ${transactionData.rowHash}`);
        console.log(`Node ${network.myNodeUrl}: Recalculated Hash: ${reCalculatedHash}`);

        if (reCalculatedHash !== transactionData.rowHash) {
            console.error(`Node ${network.myNodeUrl}: Received transaction hash mismatch. Rejecting.`);
            return res.status(400).json({ error: 'Transaction hash mismatch. Data may be corrupted.' });
        }
        console.log(`Node ${network.myNodeUrl}: Passed Check-2 (Hash validation successful)`);

        // Add the received transaction to this node's mempool.
        // createTransaction is designed to use provided IDs/hashes if they exist.
        await db.createTransaction(transactionData);

        res.status(201).json({
            message: 'Transaction received and accepted into mempool.',
            transaction: transactionData
        });
    } catch (error) {
        console.error(`Node ${network.myNodeUrl}: Error in POST /api/transactions/receive:`, error.message);
        if (error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: mempool_transactions.transaction_id')) {
            return res.status(409).json({ error: 'Transaction ID already exists in mempool.' });
        }
        res.status(500).json({ error: 'Failed to accept received transaction.' });
    }
});


// ---------------------------------------------------------------------------
// SUBMIT — accepts a raw transaction from a client and originates it.
// ---------------------------------------------------------------------------

// This is the starting point for a new transaction on the network.
// db.createTransaction() assigns the ID, timestamp, and rowHash.
// The complete transaction object is then broadcast to all known peer nodes.
router.post('/submit', async function (req, res) {
    console.log(`Node ${network.myNodeUrl}: New transaction submitted by client...`);
    const rawTransactionData = req.body;
    try {
        // 1. Insert into local mempool first — this always succeeds regardless of
        //    whether peers are reachable. Local consistency is never sacrificed.
        const newTransaction = await db.createTransaction(rawTransactionData);
        console.log(`Node ${network.myNodeUrl}: Transaction ${newTransaction.transactionId} added to local mempool.`);

        // 2. Broadcast to all known peer nodes (non-blocking — peer failures
        //    do not roll back the local insert).
        let broadcastSuccessCount = 0;
        let broadcastFailCount = 0;
        const failedUrls = [];

        const broadcastPromises = network.networkNodes.map(async (networkNodeUrl) => {
            try {
                // TODO BUG-1: URL is missing '/api' prefix. Correct: /api/transactions/receive
                await axios.post(`${networkNodeUrl}/transactions/receive`, newTransaction, { timeout: config.BROADCAST_TIMEOUT_MS });
                broadcastSuccessCount++;
            } catch (error) {
                console.warn(`Node ${network.myNodeUrl}: Broadcast to ${networkNodeUrl} failed: ${error.message}`);
                broadcastFailCount++;
                failedUrls.push(networkNodeUrl);
            }
        });

        // 3. Wait for all broadcast attempts to complete
        await Promise.all(broadcastPromises);

        // 4. If some broadcasts failed, queue for retry
        if (failedUrls.length > 0) {
            network.addToPendingBroadcasts(newTransaction, failedUrls);
        }

        // 5. Always respond success since local mempool was updated
        // Include broadcast status for transparency
        res.status(201).json({
            note: broadcastFailCount === 0 
                ? 'Transaction created locally and broadcast successfully.'
                : `Transaction created locally. ${broadcastSuccessCount}/${network.networkNodes.length} broadcasts succeeded. ${broadcastFailCount} queued for retry.`,
            transaction: newTransaction,
            broadcastStatus: {
                total: network.networkNodes.length,
                success: broadcastSuccessCount,
                failed: broadcastFailCount,
                pendingRetry: failedUrls.length > 0
            }
        });

    } catch (error) {
        // Only fail if local mempool insertion failed
        console.error(`Node ${network.myNodeUrl}: Transaction submission failed:`, error.message);
        res.status(500).json({
            note: 'Transaction failed to create locally.',
            error: error.message
        });
    }
});

// ---------------------------------------------------------------------------
// GET /api/transactions — returns all confirmed (mined) transactions.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    console.log(`Node ${network.myNodeUrl}: Fetching all confirmed transactions...`);
    try {
        const transactions = await db.readAllTransactions();
        res.status(200).json({ transactions });
    } catch (error) {
        console.error(`Node ${network.myNodeUrl}: Error fetching confirmed transactions:`, error.message);
        res.status(500).json({ error: 'Failed to retrieve transactions.' });
    }
});

module.exports = router;