// config.js
// =============================================================================
// Central configuration for all tunable constants across the application.
//
// Import this module in any file that needs a threshold or interval value.
// Defining all magic numbers here means a single change propagates everywhere.
// =============================================================================

'use strict';

module.exports = {

    // -------------------------------------------------------------------------
    // Mining  (RegAuth node only)
    // -------------------------------------------------------------------------

    /** Number of pending mempool transactions that triggers a block mine. */
    TRANSACTIONS_PER_BLOCK: 5,

    /** How often RegAuth polls the mempool to check the mining threshold (ms). */
    MINE_CHECK_INTERVAL_MS: 10_000,

    // -------------------------------------------------------------------------
    // Network health
    // -------------------------------------------------------------------------

    /** How often project nodes ping RegAuth to confirm it is reachable (ms). */
    HEARTBEAT_INTERVAL_MS: 30_000,

    /** Axios timeout applied to every inter-node HTTP call (ms). */
    BROADCAST_TIMEOUT_MS: 5_000,

    /** A pending broadcast is abandoned after this many failed retry attempts. */
    MAX_BROADCAST_RETRIES: 5,

    // -------------------------------------------------------------------------
    // Chain integrity
    // -------------------------------------------------------------------------

    /** How often every node re-derives and verifies its entire local chain (ms). */
    INTEGRITY_CHECK_INTERVAL_MS: 5 * 60_000,
};
