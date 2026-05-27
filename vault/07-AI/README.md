# 07 — AI

Two distinct topics live here:
1. **AI features planned for the product** — intelligent analysis of the environmental data already in the chain.
2. **AI-assisted development notes** — prompts, patterns, and lessons from using AI tools during development.

---

## Planned AI Features (Product)

### Context
The blockchain accumulates environmental readings (SO2, NO2, PM10, PM2_5) from multiple monitoring stations over time. Once a meaningful volume of confirmed data exists, AI/ML can add a layer of intelligence above the raw audit trail.

### Feature Ideas

| Feature | Description | Complexity |
|---|---|---|
| **Anomaly detection** | Flag readings that deviate significantly from a station's historical baseline. Alert RegAuth if a spike looks suspicious (sensor fault vs. real event vs. data tampering). | Medium |
| **Trend analysis** | Rolling averages per pollutant per station. Identify seasonal patterns, deteriorating air quality zones. | Low |
| **Cross-station correlation** | If SO2 spikes at station A but not nearby station B, flag as a localised event. | Medium |
| **Tamper probability scoring** | ML model trained on known-good chains. Score new blocks on the likelihood that any reading was manually altered (complement to the deterministic hash check). | High |
| **Natural language reporting** | Auto-generate regulatory compliance summaries from chain data. E.g. "Station Alpha exceeded WHO NO2 guidelines on 3 occasions in March." | Medium (LLM) |

### Data Access Pattern
All confirmed transactions are available via `GET /api/transactions`. For AI workloads, a dedicated read replica (V1+) or a PostgreSQL analytics view is preferable to querying the live chain.

### V1 Integration Point
- NestJS module: `AiModule`
- Service: `AiAnalysisService` — reads from PostgreSQL, calls inference endpoint
- Inference: Python microservice (FastAPI + scikit-learn / PyTorch) or external API (OpenAI, Azure AI)
- Output: written back to a separate `ai_insights` table; surfaced in the React frontend

---

## AI-Assisted Development Notes

### Tools Used
- **GitHub Copilot (Claude Sonnet 4.6)** — primary coding assistant throughout V0 development

### Session Patterns That Worked Well
- Providing the full file content before requesting refactoring (avoids hallucinated context)
- Asking for `multi_replace_string_in_file` in a single call to batch all changes in one file
- Keeping bug documentation separate from refactoring tasks (parallel workstreams)
- Using structured TODO lists with IDs (BUG-1, QW-1, PF-1) so the AI can cross-reference precisely

### Prompts Worth Keeping

**Refactor a route file with section headers and JSDoc**:
> "Refactor `routes/network.js`. Add `'use strict'`, a file header explaining the module's role, section dividers (1 per logical group of functions), and JSDoc for all exported/key functions. Do not change any logic."

**Generate a vault section from session context**:
> "Create `vault/01-Architecture/README.md`. Pre-populate it from what we've established: the data model (bchain, mempool_transactions, confirmed_transactions, audit_log), the hashing formulas, the tech stack, and at least two ADRs."

### Things to Avoid
- Asking for edits without providing the current file content → leads to incorrect context assumptions
- Batching unrelated tasks in a single message → harder for the AI to track completion state
- Letting the AI suggest "improvements" beyond what was explicitly asked → scope creep risk
