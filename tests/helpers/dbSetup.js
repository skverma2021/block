'use strict';
// =============================================================================
// Test helper: manages test SQLite database lifecycle.
// Each test file uses a unique filename so Jest's per-file module isolation
// keeps DB state fully contained within the suite.
// =============================================================================

const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3').verbose();
const db      = require('../../db');

/**
 * Prepares a fresh test database.
 * Closes any open connection first, deletes any leftover file, then
 * initialises the DB with the given projId.
 *
 * @param {string} projId   - '0' for RegAuth (gets genesis block); any other for project node.
 * @param {string} filename - Unique filename under data/, e.g. 'test-scenario-c.db'
 * @returns {object} The db module, ready to use.
 */
async function setupTestDb(projId, filename) {
    try { await db.closeDb(); } catch (_) { /* not open yet — ignore */ }

    const filePath = path.join(__dirname, '../../data', filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.setProjId(projId);
    db.setDbFile(filename);
    await db.initDb();
    return db;
}

/**
 * Closes the DB connection and deletes the test file.
 * @param {string} filename
 */
async function teardownTestDb(filename) {
    try { await db.closeDb(); } catch (_) { /* ignore */ }
    const filePath = path.join(__dirname, '../../data', filename);
    if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore lock races */ }
    }
}

/**
 * Opens a direct sqlite3 connection to the test DB file.
 * Used to corrupt data without going through db.js (for tamper-detection tests).
 * @param {string} filename
 * @returns {sqlite3.Database}
 */
function openDirectConn(filename) {
    const filePath = path.join(__dirname, '../../data', filename);
    return new sqlite3.Database(filePath);
}

/** Run a DML statement on the direct connection. Returns a Promise. */
function runDirect(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

/** Query a single row on the direct connection. */
function getDirect(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/** Query multiple rows on the direct connection. */
function allDirect(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

/** Close a direct connection. */
function closeDirect(conn) {
    return new Promise((resolve, reject) =>
        conn.close(err => (err ? reject(err) : resolve()))
    );
}

module.exports = {
    setupTestDb,
    teardownTestDb,
    openDirectConn,
    runDirect,
    getDirect,
    allDirect,
    closeDirect,
};
