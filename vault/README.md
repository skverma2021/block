# Environmental Monitoring Blockchain — Vault Index

> **Version 0** — Node.js / Express 5 / SQLite PoC  
> **Version 1** — NestJS / TypeScript / PostgreSQL / Docker (planned)

This vault is the single source of truth for all project knowledge: architecture decisions, domain context, API reference, operating guides, and the roadmap.

---

## Sections

| Folder | Contents |
|---|---|
| [00-Project](00-Project/README.md) | Brief, glossary, stakeholders, decision log |
| [01-Architecture](01-Architecture/README.md) | System design, data models, tech stack, ADRs |
| [02-Domain](02-Domain/README.md) | Environmental monitoring context, PoA consensus, regulatory roles |
| [03-API](03-API/README.md) | Endpoint reference, payloads, error codes |
| [04-Operations](04-Operations/README.md) | Node startup runbook, multi-node setup, database files |
| [05-Dev](05-Dev/README.md) | Bug register, Version 0 TODO, test notes, Version 1 spec |
| [06-Roadmap](06-Roadmap/README.md) | V0 → V1 → V2 plans, Hyperledger migration strategy |
| [07-AI](07-AI/README.md) | Planned AI features, AI-assisted development notes |

---

## Quick Status

- **Current version**: 0 (active development — bug fixes + Jest in progress)
- **Nodes**: RegAuth (port 3000) + up to N project nodes (3001+)
- **Consensus**: Proof of Authority — RegAuth is sole miner
- **Transport**: REST over HTTP (all inter-node calls use `/api` prefix)
