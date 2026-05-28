/**
 * Canonical TypeScript interfaces for the Pollution Monitoring Blockchain — Version 0.
 * These are documentation artefacts only; the system is implemented in plain JavaScript.
 */

export interface ITransaction {
  transactionId: string;       // UUID v7
  timestamp: string;           // ISO-8601
  projId: string;              // '1', '2', … (not '0')
  submitterId: string;
  stationID: string;
  SO2: number;                 // μg/m³
  NO2: number;                 // μg/m³
  PM10: number;                // μg/m³
  PM2_5: number;               // μg/m³
  rowHash: string;             // SHA-256(transactionId + timestamp + JSON(readings))
}

export interface IBlock {
  index: number;               // 0 = genesis
  timestamp: string;           // ISO-8601, set at mine time
  transactions: ITransaction[];
  merkleRoot: string;          // SHA-256 tree root over all rowHash values
  prevHash: string;            // 'GENESIS' for block 0
  nonce: number;               // Always 0 (PoA)
  blockHash: string;           // SHA-256(index + timestamp + merkleRoot + prevHash + nonce + txIds)
}

export interface INetworkNode {
  url: string;                 // Full base URL, e.g. http://localhost:3001
  projId: string;
}

export interface IPendingBroadcast {
  targetUrl: string;
  transactionId: string;
  payload: ITransaction;
  attempts: number;
}

export interface IAuditLogEntry {
  id: number;
  timestamp: string;           // ISO-8601
  event_type: string;          // e.g. 'CHAIN_INTEGRITY_FAILURE', 'BLOCK_ACCEPTED'
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  block_index: number | null;
  expected_value: string | null;
  actual_value: string | null;
  description: string | null;
  resolved: 0 | 1;
}
