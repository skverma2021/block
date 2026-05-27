# 06 — Roadmap

## Version 0 — Current (JS PoC, bug fixes + tests)

**Goal**: Get the existing Node.js codebase to a state that is correct, tested, and presentable.

### Scope
- Fix BUG-1 through BUG-4 (inter-node communication, hardcoded URLs)
- Quick wins: UUID v7, remove unused `sha256` package
- Add Jest: unit tests, integration tests, chain integrity tests
- Refactor complete: `config.js`, section headers, JSDoc, `.gitignore`

### Completion criteria
- All four nodes start, register, and exchange blocks correctly
- `npm test` runs 20+ Jest tests, all passing
- No hardcoded URLs; any topology can be configured via CLI args

---

## Version 1 — Rewrite (NestJS / TypeScript / PostgreSQL / Docker)

**Goal**: Production-grade architecture. Still PoA blockchain, same domain, but enterprise stack.

### Tech Stack Changes

| Layer | V0 | V1 |
|---|---|---|
| Language | JavaScript | TypeScript (strict) |
| Framework | Express 5 | NestJS (modules, DI, guards, pipes) |
| ORM | Raw SQL callbacks | Prisma |
| Database | SQLite per node | PostgreSQL (per environment) |
| Containerisation | None | Docker + Docker Compose |
| Frontend | None | React (Vite) + Tailwind |
| Auth | None | JWT (RegAuth issues tokens) |
| Logging | `console.log` | Pino (structured JSON logs) |
| Config | `config.js` | NestJS `ConfigModule` + `.env` |
| Testing | Jest (V0) | Jest + Supertest (carried over, expanded) |

### Migration Estimates

| Component | Effort |
|---|---|
| RegAuth node | ~32 person-months (full feature parity + frontend + auth) |
| First project node | ~6.5 person-months |
| Each subsequent project node | ~2.5 person-months |

### Key V1 Design Decisions (Pending)

- **P2P transport**: Keep REST, or move to WebSocket / gRPC for block/tx propagation?
- **Chain storage**: Separate PostgreSQL schema per project, or shared with row-level isolation?
- **Frontend scope**: Read-only explorer first; submission UI in a later sprint?
- **JWT authority**: Does RegAuth issue tokens? Or external OAuth provider?

---

## Version 2 — Hyperledger Fabric (Exploration)

**Goal**: Replace the custom blockchain implementation with a production-grade permissioned blockchain framework.

### Why Fabric?
- Battle-tested permissioned blockchain
- Pluggable consensus (RAFT for ordering)
- Smart contracts (chaincode) replace the mining + block logic
- Built-in identity management (MSP, certificates)
- gRPC-based peer communication replaces manual REST P2P

### Key Differences from V0/V1 Custom Chain

| Concept | V0/V1 (Custom) | V2 (Hyperledger Fabric) |
|---|---|---|
| Consensus | PoA (RegAuth mines) | RAFT ordering service |
| Smart contract | None (logic in routes) | Chaincode (Go or TypeScript) |
| Identity | `projId` string | X.509 certificates via MSP |
| Block format | Custom JSON schema | Protobuf (Fabric spec) |
| P2P transport | REST (Axios) | gRPC |
| SDK | None | `fabric-network` npm package |

### Prerequisites Before V2
- V1 complete and stable
- Team trained on Fabric concepts (ordering service, peers, channels, MSP)
- Docker Swarm or Kubernetes for multi-org deployment

### Migration Strategy
1. Map each V1 project node → one Fabric peer per org
2. Map RegAuth → Fabric ordering service + endorser policy
3. Port transaction + block logic to chaincode
4. Replace REST API layer with Fabric Gateway SDK calls
5. Keep React frontend — swap API client only

---

## Timeline (Indicative)

```
2026 Q2  Version 0 complete (bug fixes + Jest)
2026 Q3  Version 1 kickoff — RegAuth rewrite
2026 Q4  Version 1 — Project node template + frontend MVP
2027 Q1  Version 1 — Additional project nodes + hardening
2027 Q2  Version 2 exploration / prototype
```
