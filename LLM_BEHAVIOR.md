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
1. Status baseline first.
2. HAL-first command path.
3. Verification commands.
4. One to two documentation links maximum, chosen by intent policy (deep links preferred when available).
5. Short notes only when they materially help.
6. Keep MCP-grounded operational guidance first, then optionally add a brief model insight expansion (2-3 lines max) only if it adds practical context.
7. For short status prompts (for example, "Is TFE running?"), answer in fast mode: `Answer: Yes|No|Unknown`, one evidence line from HAL MCP, and one primary check command; do not narrate internal MCP tool names.

Deterministic routing policy
- If prompt is operational and matches a known workflow, use deterministic engine output.
- If no workflow matches, use model path with runtime policy prompt.
- Never invent commands or endpoints.
- Preferred tone: deterministic MCP-first answer quality is primary; model reasoning is a concise supplement, not a replacement.

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

Implementation map
- HAL execution and binary resolution: server/hal-exec.mjs
- HAL MCP stdio client and tool calls: server/hal-mcp-client.mjs
- MCP-backed behavior grounding: server/behavior-grounding.mjs
- Runtime policy and system prompt: server/policy-engine.mjs
- Deterministic workflows and educational output: server/deterministic-engine.mjs
- Runtime status parsing: server/runtime-status.mjs
- SSE output handling: server/sse.mjs
- Route wiring only: server/index.mjs
