// routes/network.js
// =============================================================================
// Manages the peer-to-peer network layer:
//   - Node registration (single, bulk, and broadcast-and-register).
//   - RegAuth availability monitoring and heartbeat.
//   - Pending broadcast retry queue (in-memory; see TODO PF-1 to persist).
//   - Health and status endpoints.
//
// NOTE BUG-1/2: Inter-node axios.post calls are missing the '/api' prefix.
//   Fix tracked in VERSION_0_TODO.
// =============================================================================

'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const config  = require('../config');

// =============================================================================
// SECTION 1: MODULE STATE
// =============================================================================

// Set via setMyNodeUrl() called from index.js on startup.
let myNodeUrl = '';

// All known peer URLs excluding self. Populated via registration endpoints.
let networkNodes = [];

// Normalise a node URL to bare origin (scheme://host:port), rejecting any
// path component that crept in (e.g. http://localhost:3001/api → http://localhost:3001).
function normalizeNodeUrl(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        return new URL(raw).origin;   // strips path, query, trailing slash
    } catch {
        return null;  // unparseable — caller should reject
    }
}

// RegAuth availability state (project nodes only).
let isRegAuthOnline   = true;
let lastRegAuthCheck  = null;

let regAuthUrl = 'http://localhost:3000'; // Updated via setRegAuthUrl() on startup.

// In-memory retry queue for failed transaction broadcasts.
// TODO PF-1: Persist this to SQLite so retries survive a process restart.
let pendingBroadcasts = [];  // [{ transaction, targetUrls, attempts, lastAttempt }]

// =============================================================================
// SECTION 2: HELPER FUNCTIONS
// =============================================================================

/** Sets this node's own URL. Called once from index.js on startup. */
function setMyNodeUrl(url) {
    myNodeUrl = url;
    console.log(`Network Module: My Node URL set to ${myNodeUrl}`);
}

/** Sets the RegAuth base URL. Called once from index.js on startup. */
function setRegAuthUrl(url) {
    regAuthUrl = url;
    console.log(`Network Module: RegAuth URL set to ${regAuthUrl}`);
}

// =============================================================================
// SECTION 3: HEALTH AND STATUS ENDPOINTS
// =============================================================================

// GET /api/network/health — pinged by peer nodes to confirm this node is up.
router.get('/health', (req, res) => {
    res.status(200).json({
        status:    'online',
        nodeUrl:   myNodeUrl,
        timestamp: new Date().toISOString()
    });
});

// GET /api/network/regauth-status — for frontends to check RegAuth connectivity.
router.get('/regauth-status', (req, res) => {
    res.status(200).json({
        isRegAuthOnline:      isRegAuthOnline,
        lastCheck:            lastRegAuthCheck,
        pendingBroadcastCount: pendingBroadcasts.length,
        regAuthUrl:           regAuthUrl
    });
});

// =============================================================================
// SECTION 4: REGAUTH HEARTBEAT (project nodes only)
// =============================================================================

/**
 * Pings RegAuth's /health endpoint. Updates isRegAuthOnline and, if RegAuth
 * just came back online, flushes the pending broadcast retry queue.
 * @returns {Promise<boolean>} true if RegAuth is reachable.
 */
async function checkRegAuthHealth() {
    try {
        const response = await axios.get(`${regAuthUrl}/api/network/health`, { timeout: 5000 });
        if (response.status === 200) {
            const wasOffline = !isRegAuthOnline;
            isRegAuthOnline = true;
            lastRegAuthCheck = new Date().toISOString();
            
            if (wasOffline) {
                console.log(`Network Module: RegAuth is back ONLINE!`);
                // Trigger retry of pending broadcasts
                await flushPendingBroadcasts();
            }
            return true;
        }
    } catch (error) {
        if (isRegAuthOnline) {
            console.warn(`Network Module: RegAuth appears to be OFFLINE: ${error.message}`);
        }
        isRegAuthOnline  = false;
        lastRegAuthCheck = new Date().toISOString();
        return false;
    }
}

/**
 * Adds a transaction to the retry queue if it is not already present.
 * Called when a broadcast attempt fails during /api/transactions/submit.
 */
function addToPendingBroadcasts(transaction, targetUrls) {
    // Check if transaction already in queue
    const exists = pendingBroadcasts.some(p => p.transaction.transactionId === transaction.transactionId);
    if (!exists) {
        pendingBroadcasts.push({
            transaction,
            targetUrls,
            attempts: 0,
            lastAttempt: null
        });
        console.log(`Network Module: Added transaction ${transaction.transactionId} to pending broadcasts queue. Queue size: ${pendingBroadcasts.length}`);
    }
}

/**
 * Retries all queued broadcasts. Called automatically when RegAuth comes back
 * online. Items that exhaust MAX_BROADCAST_RETRIES are discarded.
 */
async function flushPendingBroadcasts() {
    if (pendingBroadcasts.length === 0) return;
    
    console.log(`Network Module: Flushing ${pendingBroadcasts.length} pending broadcasts...`);
    const toRetry = [...pendingBroadcasts];
    pendingBroadcasts = [];
    
    for (const pending of toRetry) {
        pending.attempts++;
        pending.lastAttempt = new Date().toISOString();
        
        const results = await Promise.all(
            pending.targetUrls.map(url =>
                axios.post(`${url}/api/transactions/receive`, pending.transaction, { timeout: config.BROADCAST_TIMEOUT_MS })
                    .then(() => true)
                    .catch(err => {
                        console.warn(`Network Module: Retry broadcast to ${url} failed: ${err.message}`);
                        return false;
                    })
            )
        );

        const anySucceeded = results.some(r => r === true);
        if (anySucceeded) {
            console.log(`Network Module: Successfully retried broadcast for transaction ${pending.transaction.transactionId}`);
        } else {
            // All URLs failed — re-queue if under the retry limit.
            if (pending.attempts < config.MAX_BROADCAST_RETRIES) {
                console.warn(`Network Module: All URLs failed for tx ${pending.transaction.transactionId}. Re-queuing (attempt ${pending.attempts}/${config.MAX_BROADCAST_RETRIES}).`);
                pendingBroadcasts.push(pending);
            } else {
                console.error(`Network Module: Giving up on transaction ${pending.transaction.transactionId} after ${pending.attempts} attempts.`);
            }
        }
    }
}

// =============================================================================
// SECTION 5: NODE REGISTRATION ENDPOINTS
// =============================================================================

// POST /api/network/register-and-broadcast-node
// Called once per new node to join the network. This node:
//   1. Adds the new node to its own peer list.
//   2. Notifies all existing peers about the new node.
//   3. Sends the new node the full current peer list.
// TODO BUG-1: Internal axios.post calls are missing '/api' prefix.
router.post('/register-and-broadcast-node', async (req, res) => {
    console.log(`Node ${myNodeUrl}: Registering and broadcasting new node...`);
    const newNodeUrl = normalizeNodeUrl(req.body.newNodeUrl);

    if (!newNodeUrl) {
        return res.status(400).json({ error: 'newNodeUrl is required and must be a valid URL (scheme://host:port).' });
    }

    // Add the new node to this node's list if it's not already there and not self
    if (!networkNodes.includes(newNodeUrl) && newNodeUrl !== myNodeUrl) {
        networkNodes.push(newNodeUrl);
        console.log(`Node ${myNodeUrl}: Added ${newNodeUrl} to networkNodes.`);
    }

    const regPromises = networkNodes.map(existingNodeUrl => {
        if (existingNodeUrl !== newNodeUrl) {
            console.log(`Node ${myNodeUrl}: Notifying ${existingNodeUrl} about new node ${newNodeUrl}`);
            return axios.post(`${existingNodeUrl}/api/network/register-node`, { newNodeUrl })
                .catch(err => console.error(`Node ${myNodeUrl}: Error notifying ${existingNodeUrl}: ${err.message}`));
        }
        return Promise.resolve();
    });

    try {
        await Promise.all(regPromises);

        // Send the new node the full list of known peers (including self).
        // Sanitise the outgoing list so any legacy bad entries are cleaned up.
        const allNetworkNodes = [...networkNodes, myNodeUrl].map(normalizeNodeUrl).filter(Boolean);
        await axios.post(`${newNodeUrl}/api/network/register-nodes-bulk`, { allNetworkNodes });

        res.json({ note: 'New node registered with network and broadcasted.', networkNodes: networkNodes });
    } catch (err) {
        console.error(`Node ${myNodeUrl}: Error during register-and-broadcast-node: ${err.message}`);
        res.status(500).json({ error: 'Failed to register and broadcast node.', details: err.message });
    }
});


// POST /api/network/register-node
// Adds a single peer to this node's list. Used directly by Postman when
// register-and-broadcast-node is unavailable (e.g. during bug-fix testing).
router.post('/register-node', (req, res) => {
    console.log(`Node ${myNodeUrl}: Received request to register node...`);
    const newNodeUrl = normalizeNodeUrl(req.body.newNodeUrl);

    if (!newNodeUrl) {
        return res.status(400).json({ error: 'newNodeUrl is required and must be a valid URL (scheme://host:port).' });
    }

    if (!networkNodes.includes(newNodeUrl) && newNodeUrl !== myNodeUrl) {
        networkNodes.push(newNodeUrl);
        console.log(`Node ${myNodeUrl}: Added new node ${newNodeUrl}. Current networkNodes:`, networkNodes);
    } else {
        console.log(`Node ${myNodeUrl}: Node ${newNodeUrl} already known or is self.`);
    }
    res.json({ note: 'Node registered.' });
});

// POST /api/network/register-nodes-bulk
// Receives the full peer list from an existing node during join handshake.
router.post('/register-nodes-bulk', (req, res) => {
    console.log(`Node ${myNodeUrl}: Received bulk registration request...`);
    const allNodes = req.body.allNetworkNodes;

    if (!Array.isArray(allNodes)) {
        return res.status(400).json({ error: 'allNetworkNodes must be an array.' });
    }

    allNodes.forEach(nodeUrl => {
        const normUrl = normalizeNodeUrl(nodeUrl);
        if (normUrl && !networkNodes.includes(normUrl) && normUrl !== myNodeUrl) {
            networkNodes.push(normUrl);
            console.log(`Node ${myNodeUrl}: Added node ${normUrl} from bulk registration.`);
        }
    });
    console.log(`Node ${myNodeUrl}: Bulk registration successful. Current networkNodes:`, networkNodes);
    res.json({ note: 'Bulk registration successful.' });
});

module.exports = {
    router,
    get myNodeUrl() { return myNodeUrl; }, // Getter — always returns the current value
    networkNodes, // Exported for other modules to use (e.g., for broadcasting)
    setMyNodeUrl,  // Export setter for index.js
    setRegAuthUrl, // Export setter for index.js
    // RegAuth availability exports
    isRegAuthOnline,
    checkRegAuthHealth,
    addToPendingBroadcasts,
    flushPendingBroadcasts,
    get regAuthStatus() { return isRegAuthOnline; } // Getter for current status
};