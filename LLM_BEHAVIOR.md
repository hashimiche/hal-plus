# HAL Plus Behavior Contract

Purpose
- Keep HAL Plus responses grounded, HAL-first, and educational.
- Keep behavior stable while implementation stays modular.

Ownership split
- HAL Plus owns routing, response structure, educational framing, and product workflow logic.
- HAL MCP owns live field truth for the user's installed HAL version: current commands, flags, endpoints, runtime state, verification paths, and version-sensitive capability data.
- Cross-repo change discipline: when AI-facing behavior changes touch MCP tools, skill metadata, prompt contracts, or grounding schemas, update both repositories (`hal-plus` and `hal`) in the same work cycle so UX logic and MCP truth stay aligned.
- Behavior packs in HAL Plus may keep stable product knowledge, but runtime or version-sensitive claims must prefer HAL MCP.
- If HAL MCP is unavailable, HAL Plus may still answer with stable product logic, but it must mark live runtime facts as unknown and show the HAL/MCP checks needed to confirm them.
- New product work should default to this split unless there is a strong reason to keep a fact entirely inside HAL Plus.
- HAL Plus website runtime views (status/health/catalog grounding) must use HAL MCP tool calls and structured responses, not parsed output from `hal status`.
- MCP compatibility should be handled via tool fallbacks (for example, `hal_status_baseline` -> `get_runtime_status`) rather than direct CLI status execution.

UX contract
- Keep the main UI compact and chat-first: top status row, scrollable chat area, then prompt composer anchored at the bottom.
- The user should not need to scroll past product marketing, large playbooks, or long side panels to ask a question.
- Left-side UI should focus on relevant documentation only, and it should appear only after a question is asked and only when the prompt intent actually benefits from docs.
- Do not show generic product playbooks, curated link dumps, or lab surfaces by default.
- Documentation cards should be ranked by current prompt relevance, preferably via LLM selection over behavior-pack resources so subtopic questions do not collapse to broad product homepages.
- Documentation reveal should feel progressive and light, with a soft fade or slide rather than an abrupt panel swap.
- Status chips must stay lightweight; compact detail overlays are acceptable for both product chips and runtime chips such as MCP and token/context, but they must remain small, hover-adjacent, and never cover the main chat/composer area.
- Overlay structure should be consistent across chip types: short heading, one or two factual lines, then compact tags when useful.
- Suggestion chips are useful and should remain concise; when multiple products exist, rotate or randomize suggestions across products instead of pinning one product forever.
- Assistant answer cards should have a wide readable layout on desktop (not narrow chat bubbles) so command blocks and verification steps remain easy to scan.
- After each completed assistant answer, show a small set of follow-up question suggestions that are relevant to the preceding user prompt when possible.
- While an assistant response is streaming, use short progressive activity wording ending in "-ing" (for example, thinking, analyzing, processing) rather than static grounding-only phrasing.
- The chat message area should auto-follow streamed output to the latest chunk so users do not need to manually scroll during long answers.
- User-facing answers must stay concise by default. Include endpoints, lab surfaces, or extra links only when the user explicitly asks for them.
- Documentation links in answers should follow the lightweight URL policy layer: intent-aware mapping first, then relevance-ranked fallback. Keep at most two links per answer.

Response contract (operational prompts)
1. Status baseline first — for **enable/configure/deploy** intents this is a `Preflight:` check command (e.g. `hal vault status`) rather than a raw baseline message, because the baseline is typically generic and unhelpful for action flows.
2. HAL-first command path.
3. Verification commands.
4. One to two documentation links maximum, chosen by intent policy (deep links preferred when available).
5. Short notes only when they materially help.
6. Keep MCP-grounded operational guidance first, then optionally add a brief model insight expansion (2-3 lines max) only if it adds practical context.
7. For short status prompts (for example, "Is TFE running?"), answer in fast mode: `Answer: Yes|No|Unknown`, one evidence line from HAL MCP, and one primary check command; do not narrate internal MCP tool names.
8. If MCP baseline evidence contains "no container engine found", force `Answer: Unknown` (never infer `Yes` from generic words like "running" inside that error), and set evidence to a short probe/baseline limitation statement plus product-specific check command (for example `hal vault status`).

Deterministic routing policy
- If prompt is operational and matches a known workflow, use deterministic engine output.
- If no workflow matches, use model path with runtime policy prompt.
- Never invent commands or endpoints.
- Preferred tone: deterministic MCP-first answer quality is primary; model reasoning is a concise supplement, not a replacement.
- **Command isolation**: behavior-file `actionCommands` always appear before MCP-grounded suggestions. For subcommand-specific behaviors (e.g. `vault_k8s`, subcommand `k8s`), MCP plan/skill commands are filtered to only those that include the subcommand name — this prevents sibling-subcommand pollution (e.g. `hal vault audit` or `hal obs create` appearing in a `vault k8s` enable flow).
- The `planIntent` field in a behavior spec is passed as-is to the MCP plan tool; the raw user prompt is only used as a fallback when `planIntent` is absent.

Mandatory guardrails
- Prefer HAL commands before raw commands when possible.
- Terraform helper command naming and actions must stay normalized in responses: use `hal terraform api-workflow`, `hal terraform vcs-workflow`, and `hal terraform agent` with lifecycle actions `status|enable|disable|update` only; do not suggest `create|delete` aliases.
- For `hal terraform api-workflow`, only suggest `--target primary|twin` (not `both`).
- For CSI workflows, include Enterprise prerequisite checks.
- If runtime evidence is missing, say unknown and show checks.
- For product answers, prefer HAL MCP outputs over hardcoded facts whenever the MCP tool surface can provide the same information.
- If no high-confidence intent doc match exists, fall back to one official product root doc instead of showing broad or noisy link lists.
- Container runtime behavior must assume Ollama stays on the host unless `OLLAMA_BASE_URL` explicitly says otherwise; do not imply an in-container Ollama requirement.
- In container mode, prefer MCP HTTP transport when `HAL_MCP_HTTP_URL` is configured; stdio spawn paths are for local host/dev mode.

MCP transport contract
- Two transport modes are supported:
  - **stdio** (local/dev): HAL Plus spawns the `hal` binary directly; protocol version `2024-11-05`.
  - **streamable-HTTP** (container): HAL Plus connects to `hal-mcp` container on `hal-net` via `HAL_MCP_HTTP_URL=http://hal-mcp:8080/mcp`; protocol version `2025-03-26`.
- The MCP HTTP server is the `hal mcp serve --transport streamable-http` command running inside the `hal-mcp` container.
- There is no SSH-based MCP pattern. Do not suggest or document SSH tunnelling for MCP.
- `hal-mcp` does not have access to the host container engine socket. Tool calls that shell out to podman/docker (for example `hal_status_baseline`) will report engine-unavailable in rootless container deployments. This is expected and not an error in the transport.
- When the baseline tool cannot reach the engine, HAL Plus falls back to direct HTTP health probes per product and shows a guidance message telling the user to run `hal <product> status` for full details.
- For short product status questions under this condition (for example "what is the status of Vault"), deterministic output must be: `Answer: Unknown`, concise evidence that runtime baseline could not query engine state, and `hal <product> status` as the check command.

Runtime stack (container mode)
- `hal-mcp` container: runs `hal mcp serve --transport streamable-http` on port 8080, built locally via `hal mcp create --http` (Linux multi-stage build from source — not a binary copy).
- `hal-plus` container: pulled from `ghcr.io/hashimiche/hal-plus:latest`, exposes UI on port 9000.
- Both containers share the `hal-net` podman/docker network.
- Ollama runs on the **host**, never inside a container. HAL Plus reaches it via `host.containers.internal:11434` (podman) or `host.docker.internal:11434` (docker). `OLLAMA_BASE_URL` can override.
- `hal plus create / status / delete` is the managed lifecycle CLI for the full stack (hal-mcp + hal-plus + Ollama preflight + hal-net).
- `hal plus create --image <tag>` accepts a local image tag directly (no forced registry pull when image already exists locally).

Product status / health probes
- When `hal_status_baseline` is unavailable (engine socket not mounted), HAL Plus probes each product health endpoint directly.
- Each product is probed at both its container-network hostname (`hal-vault`, `hal-consul`, etc.) **and** `127.0.0.1`, so the same logic works for `npm run dev` on the host and for container-mode deployments.
- Health endpoints used: Vault `/v1/sys/health`, Consul `/v1/status/leader`, Boundary `/v1/health`, Nomad `/v1/agent/health`, TFE `/_health_check`, Grafana `/api/health`, Prometheus `/-/healthy`, Loki `/ready`.
- Grafana, Prometheus, and Loki are grouped into a single `Observability` product row with per-component feature flags.
- Nomad is probed at port 4646 via the same dual-candidate pattern; `multipass://` is no longer used as a fallback.
- Any HTTP response (including Vault standby/sealed codes 429/472/473/503) counts as the service being reachable.

Implementation map
- HAL execution and binary resolution: `server/hal-exec.mjs`
- HAL MCP client (stdio + HTTP): `server/hal-mcp-client.mjs`
- MCP-backed behavior grounding: `server/behavior-grounding.mjs`
- Runtime policy and system prompt: `server/policy-engine.mjs`
- Deterministic workflows and educational output: `server/deterministic-engine.mjs`
- Runtime status parsing and `baselineProductsToUi`: `server/runtime-status.mjs`
- Product health probe fallback and `/api/status` logic: `server/index.mjs`
- SSE output handling: `server/sse.mjs`
