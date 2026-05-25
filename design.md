# HAL Plus — Design Document

## What Is HAL Plus

HAL Plus is the web interface for HAL (HashiCorp Academy Labs CLI).
It is an educational, chat-first operations assistant that helps users understand and run HashiCorp product workflows using HAL commands.

Source: `hal-plus/` repo. HAL CLI: `hal/` repo (or https://github.com/hashimiche/hal).

---

## Core Purpose

- Give users a chat UI to ask questions about HAL workflows and HashiCorp products.
- Answers must be HAL-first: always prefer `hal <product> <action>` over raw commands.
- Answers must be grounded: HAL MCP provides live runtime truth; behavior packs provide stable product knowledge.
- Answers must be educational: show what a command does, link to official docs, and include verification steps.

---

## Stack

- **Frontend**: TypeScript + Vite + React (`src/`)
- **Backend**: Node.js + Express (`server/`)
- **LLM**: Ollama running on the host (never in a container)
- **MCP**: HAL MCP server (`hal mcp serve`) — stdio in local dev, streamable-HTTP in container mode

This stack was chosen for iteration speed and familiarity. No strong reason to change it unless a specific capability gap appears.

---

## Runtime Modes

### Local dev
```
npm run dev
```
- HAL Plus spawns `hal` binary directly via stdio MCP (`server/hal-exec.mjs`)
- Ollama is expected at `localhost:11434`
- No containers required

### Container mode
```
hal plus create
```
- `hal-mcp` container: runs `hal mcp serve --transport streamable-http` on port 8080
- `hal-plus` container: pulled from `ghcr.io/hashimiche/hal-plus:latest`, serves UI on port 9000
- Both containers on `hal-net` podman/docker network
- Ollama stays on the host; HAL Plus reaches it via `host.containers.internal:11434` (podman) or `host.docker.internal:11434` (docker)
- `OLLAMA_BASE_URL` env var overrides the resolved Ollama URL
- `HAL_MCP_HTTP_URL=http://hal-mcp:8080/mcp` is injected automatically

Lifecycle managed via: `hal plus create|status|delete`

`hal plus create --image <tag>` accepts a local image tag for testing local builds (no registry pull when image exists).

---

## MCP Transport Contract

| Mode | Transport | Protocol version |
|------|-----------|-----------------|
| Local dev | stdio (binary spawn) | 2024-11-05 |
| Container | streamable-HTTP | 2025-03-26 |

Auto-detect logic in `server/hal-mcp-client.mjs`:
- `HAL_MCP_HTTP_URL` set → HTTP mode
- Otherwise → stdio spawn

The `hal-mcp` container does NOT mount the host engine socket. Tool calls that need engine access (e.g. `hal_status_baseline`) will return engine-unavailable. HAL Plus handles this gracefully: falls back to direct HTTP health probes per product.

---

## Product Status / Health

Primary source: `hal-health` sidecar container exposes `http://hal-health:9001/api/status` (snapshot built on host by HAL CLI and injected as env var at container start).

Fallback (dev / no containers): direct HTTP probes per product at both container hostname and `127.0.0.1`:
- Vault `/v1/sys/health`, Consul `/v1/status/leader`, Boundary `/v1/health`
- Nomad `/v1/agent/health` (port 4646), TFE `/api/v1/health/readiness`
- Grafana `/api/health`, Prometheus `/-/healthy`, Loki `/ready`

Any HTTP response (including Vault sealed/standby codes) counts as reachable.

---

## Answer Routing

Three routes — selected before any output is built. See `llm/ANSWER_QUALITY.md` for the full spec.

**Route A — Knowledge / Factual**
Trigger: conceptual or prerequisite question ("does X need a license?", "what is X?")
Output: 2–3 sentence prose + one HAL command if relevant + one doc link. No preflight/run/check blocks.

**Route B — Operational / Deploy / Configure**
Trigger: run, enable, deploy, or configure something
Output: Preflight → Run → Check → Verify → Docs → Tips
Hybrid mode: deterministic block sent to Qwen as grounding; Qwen writes intro prose, embeds block verbatim, adds brief closing.
Code intent (`isCodeIntent`): append `## Under the hood` section from behavior file `body`. Model supplement cap lifted.

**Route C — Follow-up / Contextual**
Trigger: short prompt with no behavior match, or starts with "and", "what about", "on a", "same for"
Output: skip deterministic; use `lastMatchedBehaviorId` + body as grounding, let model answer freely.

Detection helpers in `server/deterministic-engine.mjs`: `isKnowledgeQuestion()`, `isCodeIntent()`.

---

## Key Server Modules

| File | Role |
|------|------|
| `server/hal-exec.mjs` | HAL binary execution and resolution |
| `server/hal-mcp-client.mjs` | MCP client (stdio + HTTP), tool discovery |
| `server/behavior-grounding.mjs` | Behavior-pack matching + MCP-backed grounding |
| `server/policy-engine.mjs` | Runtime policy, system prompt construction |
| `server/deterministic-engine.mjs` | Intent routing, deterministic answer assembly |
| `server/runtime-status.mjs` | Runtime status parsing, `baselineProductsToUi` |
| `server/index.mjs` | Express routes, `/api/status`, `/api/chat`, `/api/docs` |
| `server/sse.mjs` | SSE output streaming |

---

## Behavior Files

Location: `llm/products/**/*.md`

Each file = one product workflow behavior. Fields include: product, subcommand, description, planIntent, actionCommands, docLinks, body.

`body` field: used only for `isCodeIntent` Route B answers (rendered as `## Under the hood`). Do NOT start body with an H1 heading — the engine wraps it inside `## Under the hood` already.

---

## UX Contract

Full spec: `UX_PARITY.md`.

Key points:
- Two-column desktop layout: left = execution feed + proposed docs; right = status row + chat + composer
- Landing mode (large header/logo) → compact mode (condensed header) on first user message
- Status chips follow Hashi Lens semantics: label = product name, hover = endpoint + state + version + features
- Visual style: VS Code light/dark palette (neutral, console-first, not flashy)
- App URL: `hal.localhost:9000`; dark mode route: `/dark`
- Assistant answer cards: wide readable layout on desktop (not narrow chat bubbles)
- Auto-scroll chat area during streaming
- Follow-up suggestion chips after each completed assistant answer

---

## Guardrails (Enforced at All Times)

- Prefer `hal <product> <action>` before raw commands.
- Never invent commands, flags, or endpoints not verified by HAL MCP.
- Terraform helper naming: `hal terraform api-workflow|vcs-workflow|agent` with `status|enable|disable|update` only. No `create|delete` aliases.
- `hal terraform api-workflow --target primary|twin` only (not `both`).
- If runtime evidence is missing, answer Unknown and show checks.
- Max two doc links per answer. Deep links preferred over product homepages.
- Container runtime: Ollama stays on the host. No in-container Ollama requirement.
- No SSH-based MCP patterns.

---

## Doc Search (Planned — Phase 1)

See `design_doc_search.md` for the full spec.

Summary: local hybrid retrieval inside the Node server process using lexical index (minisearch) + optional Ollama embedding rerank. No extra database daemon. Sources: behavior packs, `hal/docs/`, user-provided personal docs dir.

Status: design approved, not yet implemented.

---

## Open Work Tracks

| Track | Status | Notes |
|-------|--------|-------|
| Answer quality (Routes A/B/C) | In progress (branch `feature/improve-answer-quality`) | `isKnowledgeQuestion`, `isCodeIntent`, Route C follow-up, body content |
| Doc search Phase 1 | Planned | `design_doc_search.md` |
| MCP client registry refactor | Planned | Multi-MCP prep (`hal`, vault, tf, nomad, consul MCPs) |
| Terraform improvements | Ongoing | See user memory `tf-improvements-priorities.md` |