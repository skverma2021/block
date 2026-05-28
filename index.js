// index.js
// =============================================================================
// Entry point. Responsible for:
//   - Wiring up Express middleware and routes.
//   - Running initial chain synchronisation on startup (project nodes only).
//   - Starting the RegAuth mining interval (RegAuth only).
//   - Starting the periodic chain-integrity check (all nodes).
//   - Starting the RegAuth heartbeat monitor (project nodes only).
//   - Graceful shutdown.
// =============================================================================

'use strict';

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const db      = require('./db');
const config  = require('./config');
const transactionsRoutes                     = require('./routes/transactions');
const { router: blocksRouter, mineBlockInternal } = require('./routes/blocks');
const network = require('./routes/network');

const app = express();
// =============================================================================
// SECTION 1: STARTUP ARGUMENTS AND MODULE INITIALISATION
// Usage: node index.js <port> <myNodeUrl> <projId> <dbFileName>
//   port       - TCP port this node listens on (default: 3000)
//   myNodeUrl  - Full base URL of this node, e.g. http://localhost:3001
//   projId     - '0' = RegAuth (mines blocks), '1'/'2'/... = project nodes
//   dbFileName - SQLite file name stored under data/, e.g. projA.db
// =============================================================================

const PORT         = process.argv[2] || 3000;
const MY_NODE_URL  = process.argv[3];
const REG_AUTH_ID  = process.argv[4];
const DB_FILE_NAME = process.argv[5] || 'default.db';
const REG_AUTH_URL = process.argv[6] || 'http://localhost:3000';

// Propagate startup config into the db and network modules.
db.setProjId(REG_AUTH_ID);
db.setDbFile(DB_FILE_NAME);
network.setMyNodeUrl(MY_NODE_URL);
network.setRegAuthUrl(REG_AUTH_URL);

// Interval handles — kept so they can be cleared on graceful shutdown.
let mineInterval;
let heartbeatInterval;
let integrityCheckInterval;

// =============================================================================
// SECTION 2: MIDDLEWARE AND ROUTES
// =============================================================================

app.use(cors());          // Allow cross-origin requests (needed for the React dashboard).
app.use(express.json()); // Parse JSON request bodies.

app.use(express.static('frontend'));
app.use('/visualiser', express.static('visualiser'));

app.use('/api/transactions', transactionsRoutes);
app.use('/api/blocks',       blocksRouter);
app.use('/api/network',      network.router);



// Global error handler — catches any error passed via next(err).
app.use((err, req, res, next) => {
    console.error(`Node ${MY_NODE_URL}: Unhandled error:`, err.stack);
    res.status(500).json({ error: 'Internal server error.' });
});

// =============================================================================
// SECTION 3: RECOVERY — FORCE RESYNC FROM REGAUTH
// Called when local tampering is detected or a chain fork is found.
// Purges the entire local chain and rebuilds it block-by-block from RegAuth.
// =============================================================================

async function forceResyncFromRegAuth() {
    console.log(`Node ${MY_NODE_URL}: INITIATING FORCE RESYNC FROM REGAUTH...`);
    
    try {
        // 1. Purge the entire local blockchain
        console.log(`Node ${MY_NODE_URL}: Purging local blockchain...`);
        await db.purgeEntireBlockchain();
        
        // 2. Fetch full chain from RegAuth
        console.log(`Node ${MY_NODE_URL}: Fetching full chain from RegAuth...`);
        const response = await axios.get(`${REG_AUTH_URL}/api/blocks/chain`);
        const fullChain = response.data.chain;
        
        if (fullChain && fullChain.length > 0) {
            // 3. Add each block to local blockchain
            for (const block of fullChain) {
                await db.addBlockToBlockchain(block);
                const confirmedTransactionIds = block.transactions.map(tx => tx.transactionId);
                await db.removeTransactionsFromMempool(confirmedTransactionIds);
            }
            console.log(`Node ${MY_NODE_URL}: Force resync complete. Synchronized ${fullChain.length} blocks.`);
            
            // 4. Verify the new chain
            const verifyResult = await db.verifyChainIntegrity();
            if (verifyResult.valid) {
                console.log(`Node ${MY_NODE_URL}: Post-resync integrity check PASSED.`);
                return { success: true, blocksSync: fullChain.length };
            } else {
                console.error(`Node ${MY_NODE_URL}: Post-resync integrity check FAILED! This is critical.`);
                return { success: false, error: 'Post-resync integrity check failed' };
            }
        } else {
            console.log(`Node ${MY_NODE_URL}: RegAuth has no chain. Waiting for blocks.`);
            return { success: true, blocksSync: 0 };
        }
    } catch (error) {
        console.error(`Node ${MY_NODE_URL}: Force resync FAILED:`, error.message);
        await db.logTamperingAlert('RESYNC_FAILURE', 'CRITICAL', null, null, null, `Force resync failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// =============================================================================
// SECTION 4: INTEGRITY — PERIODIC CHAIN VERIFICATION
// Runs on all nodes at INTEGRITY_CHECK_INTERVAL_MS.
// Re-derives every block hash, Merkle root, and transaction hash locally.
// Project nodes also compare their chain hash against RegAuth's authoritative hash.
// Triggers a force resync if corruption or divergence is detected.
// =============================================================================

async function performIntegrityCheck() {
    console.log(`Node ${MY_NODE_URL}: Performing periodic integrity check...`);
    
    try {
        // 1. Local chain integrity verification
        const localIntegrity = await db.verifyChainIntegrity();
        
        if (!localIntegrity.valid) {
            console.error(`Node ${MY_NODE_URL}: LOCAL CHAIN CORRUPTION DETECTED at block ${localIntegrity.corruptedBlockIndex}!`);
            if (String(REG_AUTH_ID) === '0') {
                // RegAuth IS the authoritative source — resyncing from itself would wipe the chain
                // permanently with no recovery path. Log and halt further action; manual intervention required.
                console.error(`Node ${MY_NODE_URL}: RegAuth detected corruption in its own chain. NOT purging — RegAuth cannot resync from itself.`);
                console.error(`Node ${MY_NODE_URL}: Restart RegAuth to re-create genesis and rebuild the chain.`);
                return;
            }
            console.log(`Node ${MY_NODE_URL}: Initiating force resync...`);
            await forceResyncFromRegAuth();
            return;
        }
        
        // 2. Compare chain hash with RegAuth (only for project nodes)
        if (String(REG_AUTH_ID) !== '0') {
            const localChainInfo = await db.calculateChainHash();
            
            if (localChainInfo.chainHash) {
                try {
                    const regAuthResponse = await axios.get(`${REG_AUTH_URL}/api/blocks/chain-hash`, { timeout: 5000 });
                    const regAuthChainInfo = regAuthResponse.data;
                    
                    if (regAuthChainInfo.chainHash && localChainInfo.blockCount === regAuthChainInfo.blockCount) {
                        if (localChainInfo.chainHash !== regAuthChainInfo.chainHash) {
                            console.error(`Node ${MY_NODE_URL}: CHAIN HASH MISMATCH WITH REGAUTH!`);
                            console.error(`  Local:   ${localChainInfo.chainHash}`);
                            console.error(`  RegAuth: ${regAuthChainInfo.chainHash}`);
                            
                            await db.logTamperingAlert(
                                'CHAIN_HASH_MISMATCH',
                                'CRITICAL',
                                null,
                                regAuthChainInfo.chainHash,
                                localChainInfo.chainHash,
                                'Local chain hash does not match RegAuth authoritative chain'
                            );
                            
                            console.log(`Node ${MY_NODE_URL}: Initiating force resync...`);
                            await forceResyncFromRegAuth();
                        } else {
                            console.log(`Node ${MY_NODE_URL}: Chain hash matches RegAuth. All good!`);
                        }
                    } else if (localChainInfo.blockCount < regAuthChainInfo.blockCount) {
                        console.log(`Node ${MY_NODE_URL}: Local chain behind RegAuth. Will sync on next heartbeat.`);
                    }
                } catch (regAuthError) {
                    console.warn(`Node ${MY_NODE_URL}: Could not compare with RegAuth: ${regAuthError.message}`);
                }
            }
        }
        
        console.log(`Node ${MY_NODE_URL}: Integrity check complete. Chain is valid.`);
        
    } catch (error) {
        console.error(`Node ${MY_NODE_URL}: Error during integrity check:`, error.message);
    }
}

// =============================================================================
// SECTION 5: SERVER STARTUP
// Initialises the database, performs chain sync if needed, starts all
// background intervals, and begins listening for HTTP connections.
// =============================================================================

async function startServer() {
    try {
        await db.initDb(); // Initialize database connection and tables

        // --- Initial Chain Synchronization Logic (for non-RegAuth nodes) ---
        // Handles both: 1) Fresh nodes with no blocks, 2) Nodes that were down and need to catch up
        
        if (String(REG_AUTH_ID) !== '0') {
            try {
                // Step 1: Compare local chain height with RegAuth
                const localLastIndex = await db.getLastBlockIndex();
                const regAuthResponse = await axios.get(`${REG_AUTH_URL}/api/blocks/last-index`);
                const regAuthLastIndex = regAuthResponse.data.lastBlockIndex;
                
                console.log(`Node ${MY_NODE_URL}: Local chain index: ${localLastIndex}, RegAuth chain index: ${regAuthLastIndex}`);
                
                if (localLastIndex < regAuthLastIndex) {
                    // Need to sync - either full sync or partial sync
                    if (localLastIndex === -1) {
                        // Full sync - no local blocks
                        console.log(`Node ${MY_NODE_URL}: No local blockchain found. Performing full sync from RegAuth...`);
                        const fullChainResponse = await axios.get(`${REG_AUTH_URL}/api/blocks/chain`);
                        const fullChain = fullChainResponse.data.chain;
                        
                        if (fullChain && fullChain.length > 0) {
                            for (const block of fullChain) {
                                await db.addBlockToBlockchain(block);
                                const confirmedTransactionIds = block.transactions.map(tx => tx.transactionId);
                                await db.removeTransactionsFromMempool(confirmedTransactionIds);
                            }
                            console.log(`Node ${MY_NODE_URL}: Full blockchain synchronized (${fullChain.length} blocks).`);
                        }
                    } else {
                        // Partial sync - node was down and missed some blocks
                        console.log(`Node ${MY_NODE_URL}: Node behind by ${regAuthLastIndex - localLastIndex} blocks. Performing partial sync...`);
                        
                        // Step 2: Fetch missing blocks from RegAuth
                        const missingBlocksResponse = await axios.get(`${REG_AUTH_URL}/api/blocks/chain-from/${localLastIndex}`);
                        const missingBlocks = missingBlocksResponse.data.blocks;
                        
                        if (missingBlocks && missingBlocks.length > 0) {
                            // Step 3: Validate chain continuity
                            const localLastBlock = await db.getLastBlock();
                            let previousHash = localLastBlock.hash;
                            let validChain = true;
                            
                            for (const block of missingBlocks) {
                                if (block.previousBlockHash !== previousHash) {
                                    console.error(`Node ${MY_NODE_URL}: Chain continuity broken at block ${block.blockIndex}. Expected prevHash: ${previousHash}, Got: ${block.previousBlockHash}`);
                                    validChain = false;
                                    break;
                                }
                                previousHash = block.hash;
                            }
                            
                            if (validChain) {
                                // Step 4 & 5: Add missing blocks and clear mempool
                                for (const block of missingBlocks) {
                                    await db.addBlockToBlockchain(block);
                                    const confirmedTransactionIds = block.transactions.map(tx => tx.transactionId);
                                    await db.removeTransactionsFromMempool(confirmedTransactionIds);
                                }
                                console.log(`Node ${MY_NODE_URL}: Partial sync complete. Added ${missingBlocks.length} blocks.`);
                            } else {
                                // Step 6: Handle chain fork - purge and resync from RegAuth
                                console.warn(`Node ${MY_NODE_URL}: Chain fork detected! Initiating force resync from RegAuth...`);
                                await db.logTamperingAlert(
                                    'CHAIN_FORK_DETECTED',
                                    'CRITICAL',
                                    missingBlocks[0]?.blockIndex || localLastIndex,
                                    null,
                                    null,
                                    'Chain fork detected during partial sync - local chain diverges from RegAuth'
                                );
                                await forceResyncFromRegAuth();
                            }
                        }
                    }
                } else if (localLastIndex === regAuthLastIndex) {
                    console.log(`Node ${MY_NODE_URL}: Local chain is up to date with RegAuth.`);
                } else {
                    // Local chain is ahead of RegAuth - shouldn't happen in PoA with single miner
                    console.warn(`Node ${MY_NODE_URL}: Local chain (${localLastIndex}) is AHEAD of RegAuth (${regAuthLastIndex}). This is unexpected!`);
                }
            } catch (syncError) {
                console.error(`Node ${MY_NODE_URL}: Error syncing chain from RegAuth:`, syncError.message);
                // Continue running, but node might be out of sync.
            }
        }
        // --- End Initial Chain Synchronization Logic ---


        // --- RegAuth Specific Mining Logic ---
        if (String(REG_AUTH_ID) === '0') { // Only RegAuth (node with ID '0') mines
            console.log(`Node ${MY_NODE_URL}: RegAuth node. Starting mining check interval...`);
            mineInterval = setInterval(async () => {
                try {
                    const mempoolCount = await db.getMempoolCount();
                    console.log(`Node ${MY_NODE_URL}: RegAuth Mempool Count: ${mempoolCount}`);
                    if (mempoolCount >= config.TRANSACTIONS_PER_BLOCK) {
                        console.log(`Node ${MY_NODE_URL}: Mempool threshold reached (${config.TRANSACTIONS_PER_BLOCK} txs). Triggering mine...`);
                        await mineBlockInternal(); // Directly call the exported function
                    }
                } catch (error) {
                    console.error(`Node ${MY_NODE_URL}: Error during mining check:`, error.message);
                }
            }, config.MINE_CHECK_INTERVAL_MS);
        }
        // --- End RegAuth Specific Logic ---

        // --- Project Node Heartbeat Monitoring (for RegAuth availability) ---
        if (String(REG_AUTH_ID) !== '0') {
            console.log(`Node ${MY_NODE_URL}: Project node. Starting RegAuth heartbeat monitoring...`);
            
            // Initial health check
            await network.checkRegAuthHealth();
            
            // Start periodic heartbeat
            heartbeatInterval = setInterval(async () => {
                try {
                    const isOnline = await network.checkRegAuthHealth();
                    if (!isOnline) {
                        console.log(`Node ${MY_NODE_URL}: RegAuth offline. Transactions will be queued for retry.`);
                    }
                } catch (error) {
                    console.error(`Node ${MY_NODE_URL}: Error during heartbeat check:`, error.message);
                }
            }, config.HEARTBEAT_INTERVAL_MS);
        }
        // --- End Project Node Heartbeat Logic ---

        // --- Periodic Chain Integrity Check (for all nodes) ---
        console.log(`Node ${MY_NODE_URL}: Starting periodic integrity check (every ${config.INTEGRITY_CHECK_INTERVAL_MS / 1000}s)...`);

        // Run one check immediately on startup, then repeat on the interval.
        await performIntegrityCheck();

        integrityCheckInterval = setInterval(async () => {
            await performIntegrityCheck();
        }, config.INTEGRITY_CHECK_INTERVAL_MS);
        // --- End Periodic Integrity Check ---

        app.listen(PORT, () => {
            console.log(`Node ${MY_NODE_URL}: Server running on port ${PORT}`);
            console.log(`Node ${MY_NODE_URL}: Access at ${MY_NODE_URL}`);
        });
    } catch (error) {
        console.error(`Node ${MY_NODE_URL}: Failed to start server:`, error);
        process.exit(1);
    }
}

// =============================================================================
// SECTION 6: GRACEFUL SHUTDOWN
// Clears all background intervals and closes the database connection cleanly
// when the process receives SIGINT (Ctrl+C).
// =============================================================================

process.on('SIGINT', async () => {
    console.log(`Node ${MY_NODE_URL}: Shutting down...`);
    clearInterval(mineInterval);
    clearInterval(heartbeatInterval);
    clearInterval(integrityCheckInterval);
    await db.closeDb();
    process.exit(0);
});

startServer();