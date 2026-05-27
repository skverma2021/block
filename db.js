// db.js
// =============================================================================
// Database abstraction layer. All SQLite interaction lives here.
//
// SECTIONS
//   1. Module setup          — requires, module-level vars, setters
//   2. DB initialisation     — initDb (schema creation + genesis block), closeDb
//   3. Mempool operations    — createTransaction, getMempoolCount,
//                               getTransactionsForBlock, removeTransactionsFromMempool
//   4. Blockchain operations — addBlockToBlockchain, getLastBlock,
//                               getLastBlockIndex, getAllBlocks, getBlocksFromIndex
//   5. Security              — tampering detection, integrity verification,
//                               chain hash, purge
// =============================================================================

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

// =============================================================================
// SECTION 1: MODULE SETUP
// =============================================================================

let theProj;       // Project/role ID set via setProjId().
let fileName;      // DB file name set via setDbFile().
let DB_FILE_PATH;  // Resolved absolute path to the SQLite file.
let db;            // Active sqlite3.Database instance.

/**
 * Sets the project/role ID for this node.
 * '0' = RegAuth (creates genesis block); any other value = project node.
 * Must be called before initDb().
 * @param {string} projId
 */
function setProjId(projId) {
    theProj = projId;
    console.log(`DB Module: Project ID set to ${theProj}`);
}

/**
 * Sets the SQLite database file name and resolves its path under data/.
 * Creates the data/ directory if it does not already exist.
 * Must be called before initDb().
 * @param {string} fname - File name only, e.g. 'regauth.db'
 */
function setDbFile(fname) {
    fileName     = fname;
    DB_FILE_PATH = path.join(__dirname, 'data', fileName);
    console.log(`DB Module: Using database file at: ${DB_FILE_PATH}`);

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
        console.log(`DB Module: Created data directory: ${dataDir}`);
    }
}
// =============================================================================
// SECTION 2: DATABASE INITIALISATION
//
// initDb() opens the SQLite file, enables foreign-key enforcement, creates
// the four tables (bchain, mempool_transactions, confirmed_transactions,
// audit_log) if they do not exist, then:
//   - If RegAuth (projId 0) and no blocks exist: creates the genesis block.
//   - If project node and no blocks exist: resolves and waits for sync.
//   - If blocks already exist: resolves immediately (startup sync in index.js
//     will catch up any missed blocks).
// =============================================================================

/**
 * Initialises the SQLite database. Must be called once, before any other
 * db function, typically from startServer() in index.js.
 * @returns {Promise<sqlite3.Database>}
 */
function initDb() {
    return new Promise((resolve, reject) => {
        if (!DB_FILE_PATH) {
            return reject(new Error("DB Module: Database file path not set. Call setDbFile() first."));
        }

        db = new sqlite3.Database(DB_FILE_PATH, (err) => {
            if (err) {
                console.error('DB Module: Error opening database:', err.message);
                return reject(err);
            }
            console.log(`DB Module: Connected to SQLite database at ${DB_FILE_PATH}`);

            db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
                if (pragmaErr) {
                    console.error('DB Module: Error enabling foreign keys:', pragmaErr.message);
                    return reject(pragmaErr);
                }
                console.log('DB Module: Foreign key enforcement enabled.');
            });

            const ensureBchain = `CREATE TABLE IF NOT EXISTS bchain (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blockIndex INTEGER NOT NULL UNIQUE,
                timestamp TEXT NOT NULL,
                transactions TEXT NOT NULL, -- JSON string of transaction IDs/hashes in the block
                nonce INTEGER NOT NULL,
                hash TEXT NOT NULL,
                previousBlockHash TEXT NOT NULL,
                merkleRoot TEXT NOT NULL
            )`;

            const ensureMempoolTransactions = `CREATE TABLE IF NOT EXISTS mempool_transactions (
                internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL, -- This is your UUID
                projId TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                submitter_id TEXT NOT NULL,
                station_id TEXT,
                so2 REAL,
                no2 REAL,
                pm10 REAL,
                pm2_5 REAL,
                raw_data_json TEXT NOT NULL, -- Stores the original raw transaction JSON string
                rowHash TEXT NOT NULL
            )`;

            const ensureConfirmedTransactions = `CREATE TABLE IF NOT EXISTS confirmed_transactions (
                internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL, -- This is your UUID
                block_id INTEGER NOT NULL, -- Foreign key to bchain.id
                projId TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                submitter_id TEXT NOT NULL,
                station_id TEXT,
                so2 REAL,
                no2 REAL,
                pm10 REAL,
                pm2_5 REAL,
                raw_data_json TEXT NOT NULL,
                rowHash TEXT NOT NULL,
                FOREIGN KEY (block_id) REFERENCES bchain(id)
            )`;

            // Audit log table for tampering detection
            const ensureAuditLog = `CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                block_index INTEGER,
                expected_value TEXT,
                actual_value TEXT,
                description TEXT NOT NULL,
                resolved INTEGER DEFAULT 0
            )`;

            db.serialize(() => {
                db.run(ensureBchain, (err) => {
                    if (err) { console.error('DB Module: Error creating bchain table:', err.message); return reject(err); }
                    console.log('DB Module: Table "bchain" ensured to exist.');
                });
                db.run(ensureMempoolTransactions, (err) => {
                    if (err) { console.error('DB Module: Error creating mempool_transactions table:', err.message); return reject(err); }
                    console.log('DB Module: Table "mempool_transactions" ensured to exist.');
                });
                db.run(ensureConfirmedTransactions, (err) => {
                    if (err) { console.error('DB Module: Error creating confirmed_transactions table:', err.message); return reject(err); }
                    console.log('DB Module: Table "confirmed_transactions" ensured to exist.');
                });
                db.run(ensureAuditLog, (err) => {
                    if (err) { console.error('DB Module: Error creating audit_log table:', err.message); return reject(err); }
                    console.log('DB Module: Table "audit_log" ensured to exist.');
                });

                db.get(`SELECT COUNT(*) AS count FROM bchain`, [], (err, row) => {
                    if (err) { console.error('DB Module: Error checking genesis block:', err.message); return reject(err); }

                    if (row.count > 0) {
                        console.log('DB Module: Genesis Block already exists.');
                        resolve(db);
                    } else if (String(theProj) === '0') {
                        console.log('DB Module: Creating Genesis Block for Regulator node...');
                        const genesisBlock = {
                            blockIndex: 0,
                            timestamp: new Date().toISOString(),
                            transactions: '[]',
                            nonce: 0,
                            hash: crypto.createHash('sha256').update('regulator_genesis_block_v1').digest('hex'),
                            previousBlockHash: '0',
                            merkleRoot: crypto.createHash('sha256').update('genesis_merkle_root_v1').digest('hex')
                        };

                        const insertGenesis = `
                            INSERT INTO bchain (blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `;
                        db.run(insertGenesis, [
                            genesisBlock.blockIndex,
                            genesisBlock.timestamp,
                            genesisBlock.transactions,
                            genesisBlock.nonce,
                            genesisBlock.hash,
                            genesisBlock.previousBlockHash,
                            genesisBlock.merkleRoot
                        ], function (err) {
                            if (err) { console.error('DB Module: Error creating Genesis Block:', err.message); return reject(err); }
                            console.log('DB Module: Genesis Block created.');
                            resolve(db);
                        });
                    } else {
                        console.log('DB Module: No genesis block found. Awaiting genesis block from RegAuth node.');
                        resolve(db);
                    }
                });
            });
        });
    });
}

/**
 * Closes the active SQLite connection. Called on graceful shutdown.
 * Safe to call even if initDb() was never completed.
 * @returns {Promise<void>}
 */
function closeDb() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('DB Module: Error closing database:', err.message);
                    reject(err);
                } else {
                    console.log('DB Module: Database connection closed.');
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

// =============================================================================
// SECTION 3: MEMPOOL OPERATIONS
//
// Transactions live in mempool_transactions until a block is mined.
// On block creation they move to confirmed_transactions and are removed
// from the mempool.
// =============================================================================

/**
 * Creates a new transaction record in the mempool.
 *
 * When called from /api/transactions/submit (new transaction):
 *   - Generates transactionId (UUID), timestamp, and rowHash.
 *
 * When called from /api/transactions/receive (peer-broadcast transaction):
 *   - Uses the provided transactionId, timestamp, and rowHash as-is
 *     (hash was already re-validated by the route handler before calling here).
 *
 * rowHash = SHA-256( transactionId + timestamp + rawDataJson )
 *
 * @param {object} transactionData - Raw fields from the request body.
 * @returns {Promise<object>} The complete transaction object as stored.
 */
async function createTransaction(transactionData) {
    if (!db) {
        throw new Error("DB Module: Database not initialized. Call initDb() first.");
    }
    if (theProj === undefined && transactionData.projId === undefined) {
        throw new Error("DB Module: Project ID not set for this node or provided in transaction data.");
    }

    const finalTransactionId = transactionData.transactionId || uuidv4().split('-').join('');
    const finalTimestamp = transactionData.timestamp || new Date().toISOString();
    const finalProjId = transactionData.projId !== undefined ? String(transactionData.projId) : String(theProj);

    const rawDataForHash = transactionData.rawDataJson || JSON.stringify({
        submitterId: transactionData.submitterId,
        stationID: transactionData.stationID,
        SO2: transactionData.SO2,
        NO2: transactionData.NO2,
        PM10: transactionData.PM10,
        PM2_5: transactionData.PM2_5
    });

    const finalRowHash = transactionData.rowHash || crypto.createHash('sha256').update(finalTransactionId + finalTimestamp + rawDataForHash).digest('hex');

    const { submitterId, stationID, SO2, NO2, PM10, PM2_5 } = transactionData;

    const sql = `INSERT INTO mempool_transactions
                 (projId, transaction_id, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    try {
        await new Promise((resolve, reject) => {
            db.run(sql, [
                finalProjId,
                finalTransactionId,
                finalTimestamp,
                submitterId,
                stationID,
                SO2,
                NO2,
                PM10,
                PM2_5,
                rawDataForHash,
                finalRowHash
            ], function (err) {
                if (err) {
                    console.error('DB Module: Error inserting transaction into mempool:', err.message);
                    reject(err);
                } else {
                    console.log(`DB Module: Transaction inserted into mempool with ID: ${finalTransactionId}`);
                    resolve();
                }
            });
        });

        return {
            transactionId: finalTransactionId,
            timestamp: finalTimestamp,
            rowHash: finalRowHash,
            projId: finalProjId,
            rawDataJson: rawDataForHash,
            submitterId, stationID, SO2, NO2, PM10, PM2_5
        };
    } catch (error) {
        throw error;
    }
}

/**
 * Returns all confirmed (mined) transactions ordered by timestamp descending.
 * @returns {Promise<object[]>}
 */
function readAllTransactions() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        const sql = `SELECT * FROM confirmed_transactions ORDER BY timestamp DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('DB Module: Error reading confirmed transactions:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => ({
                    internal_id: row.internal_id,
                    transactionId: row.transaction_id,
                    block_id: row.block_id,
                    projId: row.projId,
                    timestamp: row.timestamp,
                    submitterId: row.submitter_id,
                    stationID: row.station_id,
                    SO2: row.so2,
                    NO2: row.no2,
                    PM10: row.pm10,
                    PM2_5: row.pm2_5,
                    fullData: JSON.parse(row.raw_data_json),
                    rowHash: row.rowHash
                }));
                resolve(transactions);
            }
        });
    });
}

/**
 * Returns the current number of transactions waiting in the mempool.
 * @returns {Promise<number>}
 */
function getMempoolCount() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        db.get(`SELECT COUNT(*) AS count FROM mempool_transactions`, (err, row) => {
            if (err) {
                console.error('DB Module: Error getting mempool count:', err.message);
                reject(err);
            } else {
                resolve(row.count);
            }
        });
    });
}

/**
 * Retrieves up to `limit` transactions from the mempool, ordered oldest-first.
 * These are the candidates for the next block.
 * @param {number} limit - Maximum number of transactions to return.
 * @returns {Promise<object[]>}
 */
function getTransactionsForBlock(limit) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        db.all(`SELECT * FROM mempool_transactions ORDER BY timestamp ASC LIMIT ?`, [limit], (err, rows) => {
            if (err) {
                console.error('DB Module: Error getting transactions for block:', err.message);
                reject(err);
            } else {
                const transactions = rows.map(row => {
                    return {
                        transactionId: row.transaction_id,
                        projId: row.projId,
                        timestamp: row.timestamp,
                        submitterId: row.submitter_id,
                        stationID: row.station_id,
                        SO2: row.so2,
                        NO2: row.no2,
                        PM10: row.pm10,
                        PM2_5: row.pm2_5,
                        rawDataJson: row.raw_data_json,
                        rowHash: row.rowHash
                    };
                });
                resolve(transactions);
            }
        });
    });
}

/**
 * Removes a set of confirmed transactions from the mempool by their IDs.
 * Called after a block is successfully added to the chain.
 * @param {string[]} transactionIds
 * @returns {Promise<number>} Number of rows deleted.
 */
function removeTransactionsFromMempool(transactionIds) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        if (transactionIds.length === 0) {
            return resolve(0);
        }
        const placeholders = transactionIds.map(() => '?').join(',');
        db.run(`DELETE FROM mempool_transactions WHERE transaction_id IN (${placeholders})`, transactionIds, function(err) {
            if (err) {
                console.error('DB Module: Error removing transactions from mempool:', err.message);
                reject(err);
            } else {
                console.log(`DB Module: Removed ${this.changes} transactions from mempool.`);
                resolve(this.changes);
            }
        });
    });
}

// =============================================================================
// SECTION 4: BLOCKCHAIN OPERATIONS
// =============================================================================

/**
 * Atomically inserts a block into bchain and all its transactions into
 * confirmed_transactions inside a single SQLite transaction.
 *
 * The bchain table stores a lightweight transaction list
 * [{transactionId, rowHash}] for chain-linking purposes. Full transaction
 * data is stored in confirmed_transactions and joined on read.
 *
 * @param {object} block - Full block object including a transactions array
 *   of complete transaction objects.
 * @returns {Promise<object>} The block as stored.
 */
function addBlockToBlockchain(block) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }

        const { blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot } = block;

        // Store a lightweight representation of transactions in the block metadata
        // IMPORTANT: The 'transactions' array passed into this function during initial sync
        // will now contain FULL transaction objects due to the fix in getAllBlocks.
        // So, we need to map them back to the lightweight version for the bchain table.
        const lightweightTransactions = transactions.map(tx => ({
            transactionId: tx.transactionId,
            rowHash: tx.rowHash
        }));
        const transactionsJson = JSON.stringify(lightweightTransactions);


        db.serialize(() => {
            db.run("BEGIN TRANSACTION;", (beginErr) => {
                if (beginErr) {
                    console.error('DB Module: Error beginning transaction:', beginErr.message);
                    return reject(beginErr);
                }
            });

            const insertBlockSql = `INSERT INTO bchain
                                    (blockIndex, timestamp, transactions, nonce, hash, previousBlockHash, merkleRoot)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertBlockSql, [
                blockIndex,
                timestamp,
                transactionsJson,
                nonce,
                hash,
                previousBlockHash,
                merkleRoot
            ], function(err) {
                if (err) {
                    db.run("ROLLBACK;", () => console.error('DB Module: Transaction rolled back due to block insertion error.'));
                    console.error('DB Module: Error inserting block into bchain:', err.message);
                    return reject(err);
                }
                const block_id = this.lastID;

                const insertTxPromises = transactions.map(tx => {
                    return new Promise((res, rej) => {
                        const { transactionId, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash } = tx;
                        const sql = `INSERT INTO confirmed_transactions
                                     (transaction_id, block_id, projId, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                        db.run(sql, [
                            transactionId, block_id, projId, timestamp, submitterId, stationID, SO2, NO2, PM10, PM2_5, rawDataJson, rowHash
                        ], function(txErr) {
                            if (txErr) rej(txErr);
                            else res();
                        });
                    });
                });

                Promise.all(insertTxPromises)
                    .then(() => {
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) {
                                console.error('DB Module: Error committing block transaction:', commitErr.message);
                                db.run("ROLLBACK;", () => console.error('DB Module: Transaction rolled back due to commit error.'));
                                reject(commitErr);
                            } else {
                                console.log(`DB Module: Block (index ${blockIndex}) added to blockchain with ${transactions.length} transactions and committed.`);
                                resolve(block);
                            }
                        });
                    })
                    .catch(insertErr => {
                        console.error('DB Module: Error inserting confirmed transactions:', insertErr.message);
                        db.run("ROLLBACK;", () => console.error('DB Module: Transaction rolled back due to confirmed transactions insertion error.'));
                        reject(insertErr);
                    });
            });
        });
    });
}

/**
 * Gets the last block from the 'bchain' table.
 * @returns {Promise<Object|null>} A promise that resolves with the last block object, or null if no blocks exist.
 */
function getLastBlock() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        db.get(`SELECT * FROM bchain ORDER BY blockIndex DESC LIMIT 1`, [], (err, row) => {
            if (err) {
                console.error('DB Module: Error getting last block:', err.message);
                reject(err);
            } else {
                if (row) {
                    // Parse the transactions JSON string back into an array of objects
                    row.transactions = JSON.parse(row.transactions);
                    resolve(row);
                } else {
                    resolve(null);
                }
            }
        });
    });
}

/**
 * Retrieves all blocks from the 'bchain' table, ordered by blockIndex,
 * and includes their full transaction details from 'confirmed_transactions'.
 * This is crucial for initial chain synchronization.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of block objects.
 */
function getAllBlocks() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }

        db.all(`SELECT * FROM bchain ORDER BY blockIndex ASC`, [], async (err, rows) => {
            if (err) {
                console.error('DB Module: Error getting all blocks:', err.message);
                reject(err);
            } else {
                const chainPromises = rows.map(async (row) => {
                    const blockId = row.id; // Internal ID from bchain table

                    const transactionsSql = `SELECT transaction_id, projId, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash
                                             FROM confirmed_transactions WHERE block_id = ? ORDER BY internal_id ASC`;
                    const confirmedTxs = await new Promise((txResolve, txReject) => {
                        db.all(transactionsSql, [blockId], (txErr, txRows) => {
                            if (txErr) {
                                console.error(`DB Module: Error getting confirmed transactions for block ${blockId}:`, txErr.message);
                                txReject(txErr);
                            } else {
                                const parsedTxs = txRows.map(txRow => ({
                                    transactionId: txRow.transaction_id,
                                    projId: txRow.projId,
                                    timestamp: txRow.timestamp,
                                    submitterId: txRow.submitter_id,
                                    stationID: txRow.station_id,
                                    SO2: txRow.so2,
                                    NO2: txRow.no2,
                                    PM10: txRow.pm10,
                                    PM2_5: txRow.pm2_5,
                                    rawDataJson: txRow.raw_data_json,
                                    rowHash: txRow.rowHash
                                }));
                                txResolve(parsedTxs);
                            }
                        });
                    });

                    // Overwrite the lightweight transactions (from bchain.transactions) with the full ones
                    row.transactions = confirmedTxs;
                    return row;
                });

                try {
                    const fullChain = await Promise.all(chainPromises);
                    resolve(fullChain);
                } catch (promiseAllErr) {
                    console.error('DB Module: Error processing full chain for getAllBlocks:', promiseAllErr.message);
                    reject(promiseAllErr);
                }
            }
        });
    });
}

/**
 * Gets just the last block index (for quick comparison during sync).
 * @returns {Promise<number>} A promise that resolves with the last block index, or -1 if no blocks exist.
 */
function getLastBlockIndex() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }
        db.get(`SELECT blockIndex FROM bchain ORDER BY blockIndex DESC LIMIT 1`, [], (err, row) => {
            if (err) {
                console.error('DB Module: Error getting last block index:', err.message);
                reject(err);
            } else {
                resolve(row ? row.blockIndex : -1);
            }
        });
    });
}

/**
 * Retrieves blocks from the 'bchain' table starting from a specific index (exclusive),
 * and includes their full transaction details from 'confirmed_transactions'.
 * Used for partial chain synchronization when a node has been offline.
 * @param {number} startIndex - The block index to start from (exclusive - blocks AFTER this index are returned)
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of block objects.
 */
function getBlocksFromIndex(startIndex) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized. Call initDb() first."));
        }

        db.all(`SELECT * FROM bchain WHERE blockIndex > ? ORDER BY blockIndex ASC`, [startIndex], async (err, rows) => {
            if (err) {
                console.error('DB Module: Error getting blocks from index:', err.message);
                reject(err);
            } else {
                const chainPromises = rows.map(async (row) => {
                    const blockId = row.id;

                    const transactionsSql = `SELECT transaction_id, projId, timestamp, submitter_id, station_id, so2, no2, pm10, pm2_5, raw_data_json, rowHash
                                             FROM confirmed_transactions WHERE block_id = ? ORDER BY internal_id ASC`;
                    const confirmedTxs = await new Promise((txResolve, txReject) => {
                        db.all(transactionsSql, [blockId], (txErr, txRows) => {
                            if (txErr) {
                                console.error(`DB Module: Error getting confirmed transactions for block ${blockId}:`, txErr.message);
                                txReject(txErr);
                            } else {
                                const parsedTxs = txRows.map(txRow => ({
                                    transactionId: txRow.transaction_id,
                                    projId: txRow.projId,
                                    timestamp: txRow.timestamp,
                                    submitterId: txRow.submitter_id,
                                    stationID: txRow.station_id,
                                    SO2: txRow.so2,
                                    NO2: txRow.no2,
                                    PM10: txRow.pm10,
                                    PM2_5: txRow.pm2_5,
                                    rawDataJson: txRow.raw_data_json,
                                    rowHash: txRow.rowHash
                                }));
                                txResolve(parsedTxs);
                            }
                        });
                    });

                    row.transactions = confirmedTxs;
                    return row;
                });

                try {
                    const blocksFromIndex = await Promise.all(chainPromises);
                    resolve(blocksFromIndex);
                } catch (promiseAllErr) {
                    console.error('DB Module: Error processing blocks for getBlocksFromIndex:', promiseAllErr.message);
                    reject(promiseAllErr);
                }
            }
        });
    });
}

// ============================================================================
// SECURITY: Tampering Detection and Chain Integrity Functions
// ============================================================================

/**
 * Log a tampering/security event to the audit log
 */
function logTamperingAlert(eventType, severity, blockIndex, expectedValue, actualValue, description) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized."));
        }
        
        const sql = `INSERT INTO audit_log (timestamp, event_type, severity, block_index, expected_value, actual_value, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [
            new Date().toISOString(),
            eventType,
            severity,
            blockIndex,
            expectedValue,
            actualValue,
            description
        ], function(err) {
            if (err) {
                console.error('DB Module: Error logging tampering alert:', err.message);
                reject(err);
            } else {
                console.warn(`DB Module: SECURITY ALERT [${severity}] - ${eventType}: ${description}`);
                resolve(this.lastID);
            }
        });
    });
}

/**
 * Get all unresolved tampering alerts
 */
function getUnresolvedAlerts() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized."));
        }
        
        db.all(`SELECT * FROM audit_log WHERE resolved = 0 ORDER BY timestamp DESC`, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * Helper function to calculate Merkle root from transactions
 */
function calculateMerkleRoot(transactions) {
    if (!transactions || transactions.length === 0) {
        return crypto.createHash('sha256').update('empty_merkle_root_placeholder').digest('hex');
    }

    let hashes = transactions.map(tx => tx.rowHash);

    while (hashes.length > 1) {
        if (hashes.length % 2 !== 0) {
            hashes.push(hashes[hashes.length - 1]);
        }
        let newHashes = [];
        for (let i = 0; i < hashes.length; i += 2) {
            newHashes.push(crypto.createHash('sha256').update(hashes[i] + hashes[i+1]).digest('hex'));
        }
        hashes = newHashes;
    }
    return hashes[0];
}

/**
 * Verify integrity of a single block
 * Returns { valid: boolean, errors: string[] }
 */
function verifyBlockIntegrity(block, previousBlock) {
    const errors = [];
    
    // 1. Verify previous hash link
    const expectedPrevHash = previousBlock ? previousBlock.hash : '0';
    if (block.previousBlockHash !== expectedPrevHash) {
        errors.push(`Previous hash mismatch: expected ${expectedPrevHash}, got ${block.previousBlockHash}`);
    }
    
    // 2. Verify block hash
    const transactionsForBlockHash = block.transactions.map(tx => ({ id: tx.transactionId, hash: tx.rowHash }));
    const calculatedHash = crypto.createHash('sha256').update(
        block.blockIndex + block.timestamp + block.merkleRoot + block.previousBlockHash + block.nonce + JSON.stringify(transactionsForBlockHash)
    ).digest('hex');
    
    if (block.hash !== calculatedHash) {
        errors.push(`Block hash mismatch: expected ${calculatedHash}, got ${block.hash}`);
    }
    
    // 3. Verify Merkle root
    const calculatedMerkle = calculateMerkleRoot(block.transactions);
    if (block.merkleRoot !== calculatedMerkle) {
        errors.push(`Merkle root mismatch: expected ${calculatedMerkle}, got ${block.merkleRoot}`);
    }
    
    // 4. Verify each transaction hash
    for (const tx of block.transactions) {
        const dataToHash = tx.transactionId + tx.timestamp + tx.rawDataJson;
        const calculatedTxHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
        if (tx.rowHash !== calculatedTxHash) {
            errors.push(`Transaction ${tx.transactionId} hash mismatch`);
        }
    }
    
    return { valid: errors.length === 0, errors };
}

/**
 * Verify integrity of the entire local blockchain
 * Returns { valid: boolean, corruptedBlockIndex: number|null, errors: string[] }
 */
async function verifyChainIntegrity() {
    const chain = await getAllBlocks();
    
    if (chain.length === 0) {
        return { valid: true, corruptedBlockIndex: null, errors: [] };
    }
    
    let previousBlock = null;
    
    for (const block of chain) {
        const result = verifyBlockIntegrity(block, previousBlock);
        
        if (!result.valid) {
            // Log each error
            for (const error of result.errors) {
                await logTamperingAlert(
                    'CHAIN_INTEGRITY_FAILURE',
                    'CRITICAL',
                    block.blockIndex,
                    null,
                    null,
                    error
                );
            }
            
            return {
                valid: false,
                corruptedBlockIndex: block.blockIndex,
                errors: result.errors
            };
        }
        
        previousBlock = block;
    }
    
    return { valid: true, corruptedBlockIndex: null, errors: [] };
}

/**
 * Calculate a hash of the entire chain (for comparison with RegAuth)
 * This is a rolling hash of all block hashes in order
 */
async function calculateChainHash() {
    const chain = await getAllBlocks();
    
    if (chain.length === 0) {
        return { chainHash: null, blockCount: 0 };
    }
    
    // Concatenate all block hashes in order and hash the result
    const allBlockHashes = chain.map(b => b.hash).join('');
    const chainHash = crypto.createHash('sha256').update(allBlockHashes).digest('hex');
    
    return {
        chainHash,
        blockCount: chain.length,
        lastBlockIndex: chain[chain.length - 1].blockIndex
    };
}

/**
 * Purge the blockchain from a specific block index onwards
 * This is used when tampering is detected to prepare for resync
 * Returns the number of blocks deleted
 */
function purgeBlockchainFrom(startBlockIndex) {
    return new Promise(async (resolve, reject) => {
        if (!db) {
            return reject(new Error("DB Module: Database not initialized."));
        }
        
        try {
            // Log the purge event
            await logTamperingAlert(
                'CHAIN_PURGE',
                'WARNING',
                startBlockIndex,
                null,
                null,
                `Purging blockchain from block index ${startBlockIndex} due to detected corruption`
            );
            
            // Get block IDs to delete
            const blocksToDelete = await new Promise((res, rej) => {
                db.all(`SELECT id, blockIndex FROM bchain WHERE blockIndex >= ?`, [startBlockIndex], (err, rows) => {
                    if (err) rej(err);
                    else res(rows);
                });
            });
            
            if (blocksToDelete.length === 0) {
                return resolve(0);
            }
            
            const blockIds = blocksToDelete.map(b => b.id);
            
            // Delete confirmed transactions for these blocks
            await new Promise((res, rej) => {
                const placeholders = blockIds.map(() => '?').join(',');
                db.run(`DELETE FROM confirmed_transactions WHERE block_id IN (${placeholders})`, blockIds, function(err) {
                    if (err) rej(err);
                    else res(this.changes);
                });
            });
            
            // Delete the blocks
            const deletedCount = await new Promise((res, rej) => {
                db.run(`DELETE FROM bchain WHERE blockIndex >= ?`, [startBlockIndex], function(err) {
                    if (err) rej(err);
                    else res(this.changes);
                });
            });
            
            console.log(`DB Module: Purged ${deletedCount} blocks from index ${startBlockIndex} onwards`);
            resolve(deletedCount);
            
        } catch (error) {
            console.error('DB Module: Error during chain purge:', error.message);
            reject(error);
        }
    });
}

/**
 * Complete chain purge (delete all blocks) for full resync
 */
function purgeEntireBlockchain() {
    return purgeBlockchainFrom(0);
}

module.exports = {
    initDb,
    closeDb,
    setProjId,
    setDbFile,
    createTransaction,
    readAllTransactions,
    getMempoolCount,
    getTransactionsForBlock,
    removeTransactionsFromMempool,
    addBlockToBlockchain,
    getLastBlock,
    getLastBlockIndex,
    getAllBlocks,
    getBlocksFromIndex,
    // Security functions
    verifyChainIntegrity,
    calculateChainHash,
    purgeBlockchainFrom,
    purgeEntireBlockchain,
    logTamperingAlert,
    getUnresolvedAlerts
};