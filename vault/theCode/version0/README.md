# theCode / Version 0 — Feature Guide

> This section maps every runtime feature to its location in the codebase.
> Line numbers reference the refactored source as of May 2026.

| # | Feature | File |
|---|---|---|
| 00 | [Node Startup & Configuration](00-node-startup.md) | `index.js` |
| 01 | [Network Registration](01-network-registration.md) | `routes/network.js` |
| 02 | [Transaction Submit (client-originated)](02-transaction-submit.md) | `routes/transactions.js` |
| 03 | [Transaction Receive (peer-broadcast)](03-transaction-receive.md) | `routes/transactions.js` |
| 04 | [PoA Mining & Block Creation](04-mining.md) | `routes/blocks.js` |
| 05 | [Block Receive & Validation](05-block-receive.md) | `routes/blocks.js` |
| 06 | [Startup Chain Synchronisation](06-chain-sync.md) | `index.js` |
| 07 | [Periodic Integrity Verification](07-integrity-check.md) | `index.js`, `db.js` |
| 08 | [Heartbeat & Pending Broadcast Retry](08-heartbeat-and-retry.md) | `routes/network.js` |
