# 06 — Roadmap

## Strategic Direction

This project follows a deliberate three-stage path, each stage serving a distinct purpose:

| Version | Architecture | Purpose |
|---|---|---|
| **V0** | Custom PoA blockchain + minimal frontend | Demonstrate *why naive blockchain is not enough* |
| **V1** | Signed append-only log + RFC 3161 timestamps | Actual production candidate |
| **V2** | Hyperledger Fabric | Only if a named multi-party consortium is confirmed |

The key insight driving this strategy: V0 is a tamper-evident audit log with replication — useful, but not a trustless system. A single authority (RegAuth) controls the chain, so the trust model collapses to "trust RegAuth." V1 solves this with a simpler, legally-defensible architecture.

---

## Version 0 — PoA Blockchain Demo (current)

**Goal**: A working demo that honestly illustrates both the value and the limitations of a naively centralised blockchain.

### Scope
- [x] Core blockchain: mempool, mining, chain sync, integrity checks
- [x] BUG-1 through BUG-8 fixed (including RegAuth self-purge — BUG-7; tx ordering — BUG-8)
- [x] Refactored: `config.js`, section headers, JSDoc, `.gitignore`
- [x] Quick wins: UUID v7, remove unused `sha256` package
- [x] Minimal frontend: chain explorer + transaction submission UI + block detail view
- [ ] Jest: unit tests, integration tests, chain integrity tests

### Completion criteria
- [x] All nodes start, register, and exchange blocks correctly
- [x] Frontend makes the limitation visible: "Who controls RegAuth controls the chain"
- [ ] `npm test` passes all Jest scenarios

> **Status (2026-05-28):** Functionally complete. Jest test suite is the sole remaining item before V0 is fully signed off.

### Known Limitations (by design — the demo's point)
- Single miner: RegAuth is the sole block producer; a compromised RegAuth rewrites history
- Centralised sync: project nodes unconditionally trust RegAuth's chain
- No cryptographic identity: `projId` is a string argument, not a verified credential
- No legal standing: block timestamps are unverified node clocks

---

## Version 1 — Signed Append-Only Log (production candidate)

**Goal**: Replace the blockchain structure with a simpler architecture that delivers *more* practical trust at a fraction of the operational cost.

**Domain scope**: V1 is intentionally domain-agnostic. The signed log pattern applies to any auditable record (environmental readings, pharmaceutical batch records, financial transactions, supply chain events, etc.). The air quality use case becomes one possible dataset, not a hard constraint on the schema.

### Why this beats V0's blockchain for this use case
- Each record is signed by the *submitting party's private key* — RegAuth cannot forge a past entry even if it controls the database
- RFC 3161 timestamps are court-admissible in most jurisdictions (financial and pharmaceutical industries rely on them)
- Individual records are self-verifiable without the full chain
- No mining interval, no block accumulation delay, no chain sync protocol

### Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Type safety, better tooling |
| Framework | NestJS | Modules, DI, guards, pipes |
| Database | PostgreSQL (insert-only) | Standard, auditable, hosted anywhere |
| ORM | Prisma | Schema-as-code, migrations |
| Signing | Ed25519 (Node.js `crypto`) | Fast, small keys, well-supported |
| Timestamping | RFC 3161 TSA (e.g. Sectigo free TSA) | Legally recognised, neutral third party |
| Containerisation | Docker + Docker Compose | Reproducible deployments |
| Frontend | React (Vite) + Tailwind | Chain explorer + submission UI |
| Auth | JWT (NestJS guard) | Submitter identity tied to signing key |
| Testing | Jest + Supertest | Carried over and expanded from V0 |

### Trust Model
- Submitter signs each record with their Ed25519 private key before posting
- Server stores the signature alongside the record — cannot be altered without detection
- RFC 3161 timestamp is requested at insert time and stored — proves the record existed before that moment
- Auditors verify: signature (who submitted) + timestamp (when) + hash (content unchanged)
- Database admin access does not defeat this — signed rows cannot be silently forged

### Key Design Decisions (to resolve at kickoff)
- Does each project organisation manage its own signing key, or does a central CA issue them?
- Single shared PostgreSQL instance (row-level org isolation) or separate schema per org?
- Read-only public explorer vs. authenticated submission only?

### Effort Estimate (solo developer)
- Core API + signing + TSA integration: ~3 weeks
- PostgreSQL schema + Prisma setup: ~3 days
- Frontend (explorer + submission): ~2 weeks
- Docker + CI: ~3 days
- Jest coverage: ~1 week
- **Total: ~6–7 weeks**

---

## Version 2 — Hyperledger Fabric (conditional)

**Goal**: Replace the single-authority model with genuine multi-party consensus where no single organisation controls the chain.

### Trigger condition
Do not start V2 until named stakeholders from at least two independent organisations have agreed to each operate a peer node. Fabric without genuine decentralisation of participants is expensive complexity for no trust gain.

### What Fabric adds over V1
- Multiple independent orderer nodes (RAFT consensus — no single miner)
- Endorsement policies: M-of-N organisations must sign a transaction before it commits
- Per-organisation MSP: cryptographic identity, not just a JWT
- No single sync authority — each org's peer is independently authoritative

### Prerequisites
- V1 complete and in use by at least one real organisation
- Fabric fundamentals learned: MSP, channels, chaincode lifecycle, endorsement (allow ~3 weeks)
- Docker/Kubernetes infrastructure available across participating orgs

### Effort Estimate (solo developer, demo scope)
- Environment + `test-network` fluency: ~1 week
- Concept learning (MSP, channels, endorsement): ~2–3 weeks
- Custom network definition (2 orgs, 1 orderer): ~3–4 weeks
- Chaincode (submit + query + history): ~1 week
- Node.js Gateway API: ~1–2 weeks
- **Total to working demo: ~8–12 weeks**

### Migration path from V1
V1 signed records can be bulk-loaded into a Fabric ledger as historical data — the data model is compatible. The migration is an import script, not a rewrite.

---

## Timeline (Indicative)

```
2026 Q2–Q3  V0 complete: remaining tests + minimal frontend
2026 Q3–Q4  V1 build: signed log, NestJS, PostgreSQL, frontend
2027 Q1     V1 in use; evaluate consortium interest for V2
2027 Q2+    V2 exploration — only if consortium confirmed
```
