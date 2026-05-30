# HAL Plus V2 — Vision, Diagnosis & Plan (LLM Session Context)

> **Read this at the start of every new session working on the HAL Plus "V2" / scenario-teaching track.**
> This file is the continuity link across chat sessions for the effort to turn HAL Plus into a
> genuinely educational, scenario-driven AI interface for HAL.
>
> **Keep it updated.** When you discover something new, change a plan, pick an option, or finish
> a step — edit this file in the same work cycle. It must always reflect current reality.
>
> Related continuity surfaces (do not duplicate, cross-reference):
> - `hal-plus/LLM_BEHAVIOR.md` — current behavior contract (routes A/B/C, ownership split, MCP transport)
> - `hal-plus/design.md` — current architecture
> - `hal-plus/llm/ANSWER_QUALITY.md` — current answer routing spec
> - `hal-plus/design_doc_search.md` — current doc-search design
> - `hal/LLM_CONTEXT.md`, `hal/.github/copilot-instructions.md` — HAL CLI + MCP architecture

---

## 0. ⏸️ RESUME HERE (checkpoint — 2026-05-30)

**Branch:** `feature/halplus-v2` on **both** repos.

**⚠️ UNCOMMITTED (this session — deterministic Access/Observe rendering):** the work below is
implemented, live-tested, and PASSING, but **not yet committed** (awaiting user approval). Changed files:
- hal: `cmd/creds/creds.go` (haladmin reconcile + `CollectActiveCredentials()` + structured types),
  `cmd/mcp/ops_api.go` (new `get_active_credentials` tool + `handleTFEVCSWorkflowStatus` always emits
  canonical data, even on runtime-error envelope), `cmd/mcp/ops_api_test.go` (tool added to both lists).
- hal-plus: `server/scenario-registry.mjs` (`buildDeterministicScenarioBlocks` +
  `spliceDeterministicSections` + helpers), `server/sse.mjs` (`headersAlreadySet` option),
  `server/index.mjs` (Route S → non-streaming generate → splice → `streamSSESections`).

**What this session solved (the gemma4 URL-fidelity residual from the prior checkpoint):** instead of
trusting the small model to copy the deep workspace URL verbatim, **Access + Observe are now rendered
deterministically server-side**. The model writes only narrative prose and the literal placeholder
`(access details inserted automatically)` under `## Access`; HAL Plus splices in the exact Endpoints +
Credentials block (resolved from MCP `data`) and rewrites `## Observe` to strip model-emitted URLs and
append an "Open it directly:" block of verbatim links. A leaked-dotted-path scrubber (negative-lookbehind
regex so it never corrupts hostnames like `tfe.localhost`) is the final safety net.

**Key enabler:** `get_tfe_vcs_workflow_status` now returns its canonical endpoints/credentials **even when
the lab is down** (runtime-error envelope previously had `data:null`). New `get_active_credentials` tool
wraps `hal creds status` for structured per-service creds. TFE admin user reconciled to `haladmin`.

**Live test (lab DOWN, port 9021):** PASSED. Access = deterministic block with verbatim
`https://tfe.localhost:8443/app/organizations/hal/workspaces/tfe-agent-demo`, GitLab
`http://127.0.0.1:8080/root/tfe-agent-demo`, creds `root`/`hal9000FTW` + `haladmin`/`hal9000FTW`; Observe
has prose + "Open it directly:" verbatim links (incl. runs_url); zero leaked dotted paths.

**Tradeoff accepted:** scenario route (Route S) is now **non-streaming generate** (`stream:false`) so the
full answer can be spliced before sectioned SSE replay via `streamSSESections({headersAlreadySet:true})`.
Slightly higher time-to-first-token, in exchange for exact URLs/creds.

**Next actions (pick up here):**
- [ ] Get user approval, then **commit both repos** (build/test gate: hal `go build ./... && go test ./cmd/mcp/`; hal-plus `node --check`).
- [ ] **Open item to confirm:** `get_active_credentials` surfaces the live TFE API token in free-form
      `data` (CLI parity, local lab) — acceptable or gate it?
- [ ] Decide on **milestone 2 = Qdrant + source diversity** (docs/tutorials/VDD/VP/YouTube) — the
      "Learn more" / under-the-hood citations stay thin until the corpus broadens (see §4.A).
- [ ] Optional MCP follow-ups deferred in v1: `vcs_linked`/`oauth_client` (needs a TFE API call) and
      twin-target support (currently degrades gracefully). See §9.4.

<details>
<summary>Previous checkpoint — 2026-05-29 (milestone 1: scenario route + grounding fix)</summary>

**Committed + pushed at that point:**
- hal `c652513` — `mcp: add get_tfe_vcs_workflow_status structured tool`
- hal-plus `acefd43` — `scenario: wire scenario route, per-component citations, vcs grounding`

**Done so far (milestone 1 of the scenario track):**
1. Scenario layer scaffolded — `llm/scenarios/capabilities.json` (6 nodes), `shapes/*.md` (3 shapes:
   `vcs-driven-workflow`, `cli-driven-workflow`, `dynamic-secrets`), `server/scenario-registry.mjs`.
2. **Scenario route (Route S)** wired into `server/index.mjs` `/api/chat`.
3. Per-component inline citations + strict anti-placeholder grounding rule across all 3 shapes.
4. Default model → `gemma4:latest`.
5. **hal MCP tool `get_tfe_vcs_workflow_status` implemented** (read-only, structured).

The 2026-05-29 grounding fix (prompt-side path resolution + surfacing canonical data from error
envelopes) was **superseded** this session by deterministic server-side rendering for the Access/Observe
sections — the residual it left (gemma genericizing the deep workspace URL) is now moot for those
sections because the model no longer writes those URLs.
</details>

**Notes for a fresh model picking this up:**
- Read order at session start: this file → `LLM_BEHAVIOR.md` → `UX_PARITY.md` → `design.md` →
  `design_doc_search.md`; and on the hal side `hal/LLM_CONTEXT.md` + `hal/.github/copilot-instructions.md`.
- hal rules: every hal change on a named branch; **never commit without explicit user approval**; when
  MCP behavior/schema changes, update `LLM_CONTEXT.md` (and `HAL_MCP_CONTRACT.json`/`docs/commands/mcp*.md`
  /`testdata/*_help_snapshot.json` *if* they enumerate the change — they currently don't for tool adds).
- Detailed running log lives in session memory `/memories/session/hal-plus-ai-rethink.md`.

---

## 1. The Vision (what "good" looks like)

HAL Plus is the **educational AI interface** for HAL — a CLI that creates local HashiCorp setups
with scenarios (e.g. **TFE + GitLab = VCS-driven workflow showcase**).
Audience: HashiCorp/IBM interns, customers, and regular HashiCorp suite users.

**Target interaction:**

> User: *"I want to understand VCS-driven workflow with TFE"*
>
> HAL Plus should answer with a **guided scenario walkthrough**:
> 1. Provision: `hal tf create`, then `hal tf vcs-workflow enable`
> 2. Access: here are the GitLab credentials `<credentials>` and the surface `<gitlab url>`
> 3. Trigger (manual): select repo `<name>`, push a new commit to `main`
> 4. Observe: you should see a run on TFE at `<link to the run>`
> 5. **Under the hood**: explain what happened, grounded in official docs **+ tutorials + HashiCorp
>    YouTube videos + Validated Designs / Validated Patterns**.

The key word is **scenario**: a narrated, end-to-end, teach-by-doing flow — not a status check and
not a bare command dump.

---

## 2. Current State Diagnosis (why it's "not great" today)

Analyzed: `server/index.mjs` (`/api/chat`), `server/deterministic-engine.mjs`,
`server/doc-search.mjs`, `llm/products/**`, `llm/ANSWER_QUALITY.md`.

**The real problem is orchestration + scenario modeling — NOT the doc index engine.**

1. **No "scenario" route.** Routes are A (factual prose), B (Preflight→Run→Check→Verify template),
   C (follow-up). The desired narrated walkthrough fits none of them; today it gets forced through
   the rigid Route B template.
2. **The deterministic engine muzzles the model.** In hybrid mode the LLM may only write
   "1–2 sentences intro + emit the grounded block verbatim + 1–2 sentences closing." It decorates;
   it does not reason or teach. That is the main reason answers feel flat.
3. **Knowledge is modeled per-subcommand, not per-scenario.** `llm/products/terraform-enterprise/workspace.md`
   knows `hal terraform vcs-workflow enable`, but nothing ties together: products to provision →
   credentials → manual GitLab step → observable result (a TFE run) → curated explanatory sources.
   That linkage is the product's value and it does not exist as a first-class object.
4. **Corpus is narrow and single-typed.** `doc-search.mjs` crawls only Terraform + Vault developer
   docs at depth 2. No tutorials as a distinct type, no Validated Designs/Patterns, no YouTube
   transcripts. BM25 + `nomic-embed` rerank is fine for that small corpus — the limit is **breadth
   and source diversity**, not the index.
5. **Model choice.** `qwen3.5` local via Ollama is OK as a decorator, weak for multi-source
   educational synthesis and tool-use reasoning.

---

## 3. HAL MCP & LLM-doc Assessment (are they good enough?)

Verdict from inspecting `hal/cmd/mcp/ops_api.go`, `advanced.go`, `skills_index.go`, `hal/LLM_CONTEXT.md`:

- **LLM `.md` files in hal** — *good enough for now.* They document command architecture / lifecycle
  for agents working ON hal. They are NOT (and should not be) scenario-teaching content. Only revisit
  later to document any new MCP tools added (cross-repo sync discipline).
- **HAL MCP** — *good enough for status grounding, NOT good enough to source the scenario walkthrough.*
  The MCP is entirely **read-only status tools**.

**MCP tool surface today (all read-only):**
`get_runtime_status` / `hal_status_baseline`, `get_vault_status`, `get_terraform_status`,
`get_tfe_status`, `get_tfe_api_workflow_status` (+ `get_tfe_cli_status`), `get_tfe_vcs_workflow_status`, `get_boundary_status`,
`get_consul_status`, `get_nomad_status`, `get_obs_status`, `get_audit_summary`, `get_oidc_status`,
`get_jwt_status`, `get_ldap_status`, `get_vault_database_status`, `get_boundary_mariadb_status`,
`hal_status_structured`, `hal_diagnostics`, plus a skills index + component-help topics.

**MCP gaps that block the scenario vision:**
1. **~~No `get_tfe_vcs_workflow_status` tool.~~ DONE (see §9.4).** Implemented in `hal/cmd/mcp/ops_api.go`
   as `handleTFEVCSWorkflowStatus`: overlays live booleans (TFE runtime, `hal-gitlab` container,
   `~/.hal/tfe-app-api-token` presence) onto canonical primary-target defaults and returns structured
   `data.{target,gitlab{web_url,...},tfe{workspace_url,runs_url,...},lab_credentials{gitlab,tfe_admin},ready}`.
2. **~~Credentials redacted by contract.~~ RESOLVED for lab values.** The redaction check only applies to
   the typed `opCredentials` field; `lab_credentials` is returned inside the free-form `data` map
   (lab-scoped, non-secret, already CLI-printed) and is therefore surfaced deliberately.
3. **No dynamic run link.** The specific TFE run URL after a push is inherently dynamic; stays a
   "manual + here's where to look" step.
4. **`next_steps` + `docs` envelope fields exist but are underused** — already the right shape for
   scenario narration; just sparse today.

**Division of responsibility (consistent with the ownership split in LLM_BEHAVIOR.md):**

| Layer | Owns | Action |
|---|---|---|
| hal+ scenario objects | stable scenario script: ordered steps, manual action, source mix | **build new** |
| hal MCP | live scenario facts: VCS workflow state, lab endpoints, lab-credential surfacing | **DONE** (`get_tfe_vcs_workflow_status` + lab-cred path shipped) |
| hal+ doc corpus | explanatory sources (docs/tutorial/VDD/VP/video) | **broaden** (later) |

---

## 4. Options On The Table (grouped — they compose)

### A. Knowledge / retrieval layer (the "Qdrant?" question)
- **A1 (short term):** keep MiniSearch; broaden corpus (Nomad/Consul/Boundary roots, tutorials,
  Validated Designs/Patterns); tag each chunk with `source_type`
  (`docs|tutorial|validated-design|validated-pattern|video`).
- **A2 (Qdrant) — adopt once sources diversify:** persistence (no rebuild-on-restart), metadata
  filtering (guarantee one doc + one tutorial + one VDD + one video per "under the hood"),
  hybrid sparse+dense + reranking at scale, shared corpus across HAL Plus and the colleague's product.
  Qdrant fixes *corpus scale*, not orchestration — it is **step 3, not step 1**.
  **Reference implementation = Mind the Gap `feature/qdrant-poc`** (see §6 entry 2026-05-29 Qdrant);
  adopt its dual-backend + idempotent-push + filtered-search patterns.
- **YouTube:** ingest captions as `source_type=video` chunks with timestamped URL citations.
  High-value, neither product has it.

### B. The "AI piece" / orchestration (biggest lever)
- **B1 — Add a Scenario route (Route D).** Detect scenario/learning intent
  ("I want to understand X workflow", "show me X end to end") and route to a **scenario composer**.
  Give the model the scenario object + multi-source chunks as grounding and let it compose the
  narrative. Loosen the verbatim constraint for this route; keep commands MCP-verified.
- **B2 — Light agentic loop.** Let the model call MCP tools + retrieval on demand instead of the
  fixed prefetch pipeline. More adaptive; needs a stronger model (pair with B3).
- **B3 — Model upgrade.** Stronger model for scenario synthesis (larger local, or hosted for the
  scenario route only while keeping local for status/factual). Keep deterministic guardrails for
  *commands*; let the model own *prose and teaching*.

### C. Scenario modeling (makes B possible + keeps it grounded)

> **Critical constraint (2026-05-29):** the scenario space is combinatorial — products × features ×
> cross-product combos × phrasings × depth. It is effectively unbounded. **Do NOT author a scenario
> file per scenario.** Scenarios are *generated/composed*, not *enumerated*. This is the whole reason
> to use an LLM; the deterministic template engine is the wrong tool because it can only answer what
> has been pre-templated.

**C1 (REVISED) — Scenario *generator* over a bounded capability graph (not a catalog).**
Three bounded inputs + one generative step:

1. **Capability graph** — bounded, grows *linearly* with products/features (not combinatorially).
   One descriptor per product and per feature: what it is, HAL command(s) to provision/enable,
   `depends_on` edges, surfaces/credentials exposed, canonical source pointers. ~dozens of nodes.
   Adding a product/feature = add one node. **HAL already has most of this**: behavior files
   (`llm/products/**`), MCP status tools, skills index, and MCP dependency data
   (e.g. `terraform_vcs_workflow → depends_on [hal-tfe, hal-gitlab]`).
2. **Retrieval corpus** — bounded by ingestion effort, not scenario count. One Qdrant corpus
   (docs/tutorial/VDD/VP/video, tagged `source_type` + product/feature) serves every scenario.
3. **Exemplar patterns** — a *handful* (3–6), NOT a catalog. VCS is ONE exemplar. They are few-shot
   templates teaching the answer *shape* (Provision → Access → Trigger → Observe → Under the hood),
   not the answer set.
4. **Generative step** — at query time: intent → resolve capability nodes (graph traversal) → MCP
   live facts for those nodes → retrieval chunks → exemplar as format guide → model composes the
   walkthrough. **Unseen combinations are handled by model generalization**, not new files.

**Grounding rails (preserve the deterministic engine's value, moved from answer-shaper to guard rail):**
commands only from capability nodes / MCP (never invented); links only from corpus; live facts
(state, endpoints, creds, run links) only from MCP. The model owns prose/sequencing/teaching, fenced
by these rails.

**Trade-offs:** novel-combo quality needs a capable model (Gemma `27b` path) + tight grounding;
`e4b` is weaker on the long tail. The real authoring work is **accurate `depends_on` edges** (bounded,
mostly already in MCP/behavior files). Quality is best on exemplar-covered shapes and degrades
gracefully; improve by adding exemplars/corpus/edges, never by enumerating scenarios.

### D. Answer composition / UI
- **D1 — Scenario answer template:** Overview → Provision → Access (creds + surfaces) → Trigger
  (manual) → Observe (run link) → Under the hood (multi-source grounded) → Learn more (typed cards).
- **D2 — Typed source cards** grouped by `source_type` (📄 doc / 🎓 tutorial / 📐 Validated Design / ▶️ video).

---

## 5. Sequence (updated 2026-05-29 per user decisions)

1. **C1 (revised) + B1** — build the capability-graph + Scenario route (generator, not catalog).
   Reuse existing behavior files / MCP dependency data as capability nodes; author the VCS exemplar
   as the FIRST of ~3–6 shape templates; add the Scenario route so the model composes around
   MCP-verified commands/credentials/links. Transforms answers without touching the index.
2. **hal MCP extension** — add `get_tfe_vcs_workflow_status` + a deliberate lab-credential surface.
   This is the one hal-repo change the scenario genuinely requires (blocks the Access & Observe steps).
3. **Qdrant (A2) — now, in parallel** — stand up Qdrant, migrate retrieval off MiniSearch, add
   `source_type` metadata, ingest tutorials + Validated Designs/Patterns + YouTube transcripts from the
   user's curated list. Guarantee per-answer source-type coverage in the "Under the hood" section.
4. **B3 — model swap** — point the scenario route at local **Gemma** (`e4b`/`27b`) via Ollama.

---

## 6. Status / Decision Log

_Append-only. Date each entry. Record decisions, discoveries, and step completions._

- **2026-05-29** — Initial V2 analysis captured (this file created).
- **2026-05-29** — Direction decided with user:
  - **Branch:** `feature/halplus-v2` (both repos when MCP is touched).
  - **Starting scope:** C1 + B1 — scenario object + Scenario route first (no index/model swap required to start).
  - **Model:** stay local on Ollama, switch scenario synthesis to **Gemma** (user said "Gemma4"):
    `e4b` variant for low compute, `27b` variant for high compute. Status/factual routes can stay on
    current local model. Exact Ollama tag + hardware tier still to confirm. Configurable via `OLLAMA_MODEL`.
  - **Lab credentials:** confirmed **non-secret demo values — OK to surface** in answers via a deliberate
    MCP path (does NOT break the redaction contract for real secrets).
  - **Sources:** user will **provide a curated list** (HashiCorp YouTube, Validated Designs/Patterns,
    tutorials) for the VCS scenario. Awaiting the list.
  - **Qdrant:** decision changed from "defer" to **stand up now**. Sequence updated accordingly (see §5).
- **2026-05-29** — **Architectural correction (important):** user raised that the scenario space is
  combinatorial/unbounded (products × features × cross-product × phrasing × depth). C1 reframed from
  "author scenario objects per scenario" to a **scenario generator over a bounded capability graph**
  (capability nodes + Qdrant corpus + 3–6 exemplar patterns + a composer model, fenced by grounding
  rails). VCS is one exemplar, not the catalog. See §4C (revised). The deterministic engine becomes
  the grounding/guardrail layer, not the answer-shaper.
- **2026-05-29** — **Model decided:** default scenario-synthesis model = **Gemma 4** (latest), `e4b`
  tier (low-compute — users already run hal products + Ollama locally, keep footprint small). Keep a
  configurable bigger Gemma 4 model via `OLLAMA_MODEL` for high-compute hosts. Status/factual routes
  may stay on current local model. _Exact Ollama tag for the Gemma 4 `e4b` + big variants to confirm._
- **2026-05-29** — **Qdrant reference studied** — read Mind the Gap `feature/qdrant-poc`
  (`/Users/miche.sawrabakos/Projects/miche/home_lab/mind-the-gap`). Patterns to ADOPT for hal-plus:
  - **Container:** `docker-compose.yml` → `qdrant/qdrant:v1.13.6`, ports `6333` (REST) + `6334` (gRPC),
    named volume `qdrant_storage:/qdrant/storage`, `restart: unless-stopped`. Engine resolution
    (`scripts/container-cli.mjs`) prefers `docker` then `podman` — reuse verbatim.
  - **Dual backend (keep local fallback):** `VITE_RAG_BACKEND=local|qdrant` selects in-process cosine
    over pre-built corpus files vs Qdrant server search. hal-plus should keep a `local` fallback so it
    runs if Qdrant is down. NOTE: hal-plus has a **Node/Express backend** (`server/`), so the Qdrant
    query lives **server-side** (`doc-search.mjs`), not in the browser — cleaner (no CORS, embedder
    stays server-side). MTG did it browser-side because it's Vite-only.
  - **Same embedder at index + query time:** `nomic-embed-text`, **768 dims**, Cosine distance.
    hal-plus already uses `nomic-embed-text` → keep it; do NOT switch embedder.
  - **Collection setup:** `PUT /collections/<name>` vectors {size:768, distance:Cosine} + a **keyword
    payload index** on the discriminator field for filtered search. MTG indexes `kind` (aa-doc|official);
    **hal-plus uses `source_type`** (docs|api|tutorial|validated-design|validated-pattern|video) +
    `product` — enables the per-answer source-type coverage guarantee (§4D D1).
  - **Idempotent push** (`scripts/push-to-qdrant.mjs`): deterministic UUID = md5(chunkId)→UUIDv4 shape;
    incremental mode scrolls existing `sourceDoc` payloads to skip already-indexed docs; `--recreate`
    drops+rebuilds; batch upsert 100. Adopt this for the hal-plus crawler/ingest.
  - **Filtered retrieval** (`src/utils/ragService.ts` `searchQdrant`): N parallel `points/search`
    calls each filtered by the discriminator, then min-score + per-source diversity cap merged. For
    hal-plus: one filtered search per `source_type` → guarantees the "one doc + one tutorial + one VDD
    + one video" mix in "Under the hood".
  - **Orchestration** (`scripts/dev-qdrant.mjs`): start container → wait healthy
    (`scripts/wait-for-qdrant.mjs`) → index if manifest missing → push if collection empty → spawn dev.
  - **Payload schema (MTG):** id, content, sourceDoc, section, chunkIndex, kind, href, sourceTitle,
    sectionTitle. hal-plus payload should add: `source_type`, `product`, `feature`, and (for video)
    `timestampUrl`.
  - **hal-specific deltas still to confirm:** run Qdrant on `hal-net`; whether `hal plus create`
    manages its lifecycle (vs a hal-plus `dev:qdrant`-style script); persistence path under hal's data
    dir; whether to add hybrid sparse+dense later (MTG is dense-only today).
- **2026-05-29** — **Packaging / release architecture decided (pre-baked corpus, no runtime ingest).**
  Problem: ingesting at `hal plus create` time = slow boot (crawl + embed every corpus) AND repeated
  every create. Solution: **move all crawl + embed work to CI; ship a pre-loaded corpus in a published
  image.** On a **git tag in the `hal-plus` repo**, CI (GitHub Actions → **ghcr.io**) builds & pushes
  TWO images:
  1. **`ghcr.io/<org>/hal-plus:<tag>`** — UI + Express server (no corpus build at runtime).
  2. **`ghcr.io/<org>/hal-plus-qdrant:<tag>`** — `qdrant/qdrant:v1.13.6` + the **pre-built corpus**
     baked in as a Qdrant **snapshot**, plus a restore-on-first-boot entrypoint (restore only if the
     collection is absent → fast, no embedding, no crawl).
  CI corpus pipeline (runs once per release): crawl all §8 source roots → chunk → embed with
  `nomic-embed-text` (Ollama in CI) → create Qdrant snapshot → bake into the qdrant image. Corpus
  version is pinned to the image tag (reproducible; refreshing the corpus = cut a new tag).
  **Runtime (`hal plus create`):** pull both images, run on `hal-net` following hal's **naming +
  volume conventions**; Qdrant restores the baked snapshot into its named volume **only if empty**
  (fast). No runtime crawl/embed. **`hal delete`** removes both containers + volumes like any other
  hal product. Query-time embedding still uses host Ollama `nomic-embed-text` (must match the CI
  embedder version — pin/document it to avoid vector drift). Keep the MTG-style **local backend +
  `dev:qdrant` push path** for dev iteration without rebuilding images.
  - _Open sub-question:_ Option A (separate pre-loaded `hal-plus-qdrant` image, recommended — qdrant is
    a first-class managed container like other hal products) vs Option B (stock `qdrant/qdrant` +
    bundle the snapshot inside the hal-plus server image and restore via Qdrant snapshot-upload API on
    first boot — one fewer custom image, but server owns restore logic). Leaning **A**.
- **2026-05-29** — **Packaging Option A CHOSEN** (user: "A 1000%"). Ship a dedicated pre-loaded
  `ghcr.io/<org>/hal-plus-qdrant:<tag>` image (qdrant as a first-class managed hal container). Snapshot
  baked into the image at a non-mounted path + restore-on-first-boot-if-empty entrypoint, so the named
  volume (hal naming convention, cleaned by `hal delete`) is never shadowed. Option B dropped.
- **2026-05-29** — **Branch created:** `feature/halplus-v2` in hal-plus (WIP carried via stash/pop).
  Matching `feature/halplus-v2` branch also created in the **hal** repo (was on clean `main`) for the
  upcoming `get_tfe_vcs_workflow_status` MCP work.
- **2026-05-29** — **VCS-workflow investigation DONE** (read `hal/cmd/terraform/vcs-workflow.go`).
  Concrete defaults, ordered effects, observable result, draft `get_tfe_vcs_workflow_status` contract,
  and draft capability-node/scenario shape captured in **§9**. Lab creds (`root`/`hal9000FTW`,
  `haladmin`/`hal9000FTW`) confirmed non-secret + already CLI-printed → surface via a `lab_credentials`
  field exempt from the redaction contract.
- **2026-05-29** — **Capability/scenario location DECIDED — Option 2** (user: "cleanest path"):
  consolidate the **whole capability graph + scenario shape templates in one dedicated `llm/scenarios/`
  directory** (single source of truth), rather than scattering capability edges across per-product
  behavior frontmatter. Behavior files stay as-is for per-subcommand answer content; the graph/scenarios
  live separately and reference behavior `id`s. Hybrid option dropped.
- **2026-05-29** — **§10 schema FROZEN for v1** (user: "all good with your recommendations for the 4"):
  (1) format = **JSON**; (2) **single `capabilities.json`** for the whole graph; (3) **7 slots
  confirmed** (Overview→Provision→Access→Trigger→Observe→Under the hood→Learn more); (4) **dotted-path
  convention** (`tfe.runs_url`) for `linkFrom`/`access`. See §10.5. Next = create the actual files.
- **2026-05-29** — **Scenario scaffolding files CREATED** (user: "ok go"): `capabilities.json`,
  `shapes/vcs-driven-workflow.md`, `server/scenario-registry.mjs`. Smoke-tested OK. See §10.6.
  Not yet wired into /api/chat; MCP status tool still a proposal.

---

## 7. Open Questions / TODO

Decided (see §6 log): branch `feature/halplus-v2`; start C1+B1; model = local Gemma; lab creds OK to
surface; user provides source list; Qdrant now.

Still needed from user:
- [x] ~~Paste the **curated source list**~~ — DONE 2026-05-29. See §8 Source Roots Registry (Boundary,
      Vault, TF/TFE/HCP, Nomad, Consul populated; Observability scoped out — no corpus).
- [x] ~~Confirm Gemma default tier~~ — DECIDED 2026-05-29: default **Gemma 4** (latest) `e4b` tier
      (low-compute; users already run hal products + Ollama, so keep the footprint small). Keep a
      configurable path to a **bigger Gemma 4 model** via `OLLAMA_MODEL` for high-compute hosts.
      _Exact Ollama tag(s) for Gemma 4 `e4b` + big variant still to pin._
- [~] **Qdrant deployment prefs** — baseline RESOLVED 2026-05-29 by adopting the Mind the Gap
      `feature/qdrant-poc` reference (see §6): `qdrant/qdrant:v1.13.6` container (docker/podman auto-resolve),
      named-volume persistence, keep `nomic-embed-text` (768d, Cosine), dual local/qdrant backend with
      server-side query in `doc-search.mjs`. **Still to confirm:** run on `hal-net`; lifecycle owner
      (`hal plus create` vs hal-plus script); persistence path under hal's data dir; hybrid sparse+dense later.

To be discovered/spec'd by me (no user input needed):
- [x] ~~Read hal code to confirm what `hal terraform vcs-workflow enable` actually produces~~ — DONE
      2026-05-29. Source: `hal/cmd/terraform/vcs-workflow.go`. Concrete facts captured in §9.
- [ ] Finalize scenario object schema (fields, location: `llm/scenarios/`).
- [x] ~~Spec `get_tfe_vcs_workflow_status` MCP tool contract (returned fields) + lab-credential surfacing rule.~~ DONE + IMPLEMENTED (see §9.4).
- [ ] Define `source_type` taxonomy + YouTube transcript ingestion + citation format for Qdrant.

---

## 8. Source Roots Registry (corpus ingestion inputs)

Input format = **root / index / channel URLs only**. The crawler BFS-digs sub-docs and auto-tags
`product` + `feature` from URL path + heading hierarchy. No per-feature link mapping needed.
`source_type` ∈ `docs | api | tutorial | validated-design | validated-pattern | video`.
User adds these product-by-product; tables below accumulate.

### Boundary (provided 2026-05-29)
| source_type | root / URL |
|---|---|
| docs | https://developer.hashicorp.com/boundary/docs |
| api | https://developer.hashicorp.com/boundary/docs/api |
| validated-design | https://developer.hashicorp.com/validated-designs/boundary-operating-guides-adoption |
| validated-design | https://developer.hashicorp.com/validated-designs/boundary-operating-guides-standardization |
| validated-design | https://developer.hashicorp.com/validated-designs/boundary-solution-design-guides-boundary-enterprise |
| validated-pattern | https://developer.hashicorp.com/validated-patterns/boundary |
| tutorial | https://developer.hashicorp.com/boundary/tutorials |
| video | https://www.youtube.com/watch?v=tUMe7EsXYBQ |
| video (playlist) | https://www.youtube.com/playlist?list=PL81sUbsFNc5ZBUgz1Ai7-tfB7qpmqFvEO |
| video | https://www.youtube.com/watch?v=KpLfdc5vikk |

### Terraform / TFE / HCP TF (provided 2026-05-29)
| source_type | root / URL |
|---|---|
| docs | https://developer.hashicorp.com/terraform/docs |
| docs (HCP TF + API) | https://developer.hashicorp.com/terraform/cloud-docs |
| docs (TFE + API) | https://developer.hashicorp.com/terraform/enterprise |
| tutorial | https://developer.hashicorp.com/terraform/tutorials |
| validated-design | https://developer.hashicorp.com/validated-designs/terraform-operating-guides-adoption |
| validated-design | https://developer.hashicorp.com/validated-designs/terraform-operating-guides-scaling |
| validated-design | https://developer.hashicorp.com/validated-designs/terraform-operating-guides-standardization |
| validated-design | https://developer.hashicorp.com/validated-designs/terraform-solution-design-guides-terraform-enterprise |
| validated-pattern | https://developer.hashicorp.com/validated-patterns/terraform |
| video (playlist) | https://www.youtube.com/playlist?list=PL81sUbsFNc5Z93-eRproLp88vI_IxbDBY |
| video | https://www.youtube.com/watch?v=ZFLWA1kQ3ls |

> Note: TF API docs are not separate roots — HCP TF API lives under `cloud-docs`, TFE API under `enterprise`.

### Vault (provided 2026-05-29)
| source_type | root / URL |
|---|---|
| docs | https://developer.hashicorp.com/vault/docs |
| api | https://developer.hashicorp.com/vault/api-docs |
| tutorial | https://developer.hashicorp.com/vault/tutorials |
| validated-design | https://developer.hashicorp.com/validated-designs/vault-operating-guides-adoption |
| validated-design | https://developer.hashicorp.com/validated-designs/vault-operating-guides-scaling |
| validated-design | https://developer.hashicorp.com/validated-designs/vault-operating-guides-standardization |
| validated-design | https://developer.hashicorp.com/validated-designs/vault-solution-design-guides-vault-enterprise |
| validated-pattern | https://developer.hashicorp.com/validated-patterns/vault |
| video | https://www.youtube.com/watch?v=eA_9WwYwXp0 |
| video (playlist) | https://www.youtube.com/playlist?list=PL81sUbsFNc5YPS-jcIUyJQoJJtg1IIvzc |

### Nomad (provided 2026-05-29)
| source_type | root / URL |
|---|---|
| docs | https://developer.hashicorp.com/nomad/docs |
| api | https://developer.hashicorp.com/nomad/api-docs |
| tutorial | https://developer.hashicorp.com/nomad/tutorials |
| validated-design | https://developer.hashicorp.com/validated-designs/nomad-operating-guides-nomad-enterprise |
| validated-design | https://developer.hashicorp.com/validated-designs/nomad-solution-design-guides-nomad-enterprise |
| validated-pattern | https://developer.hashicorp.com/validated-patterns/nomad |
| video | https://www.youtube.com/watch?v=s_Fm9UtL4YU |
| video | https://www.youtube.com/watch?v=5_kW1HOPa-o |

### Consul (provided 2026-05-29)
| source_type | root / URL |
|---|---|
| docs | https://developer.hashicorp.com/consul/docs |
| api | https://developer.hashicorp.com/consul/api-docs |
| tutorial | https://developer.hashicorp.com/consul/tutorials |
| validated-design | https://developer.hashicorp.com/validated-designs/consul-operating-guides-adoption |
| validated-design | https://developer.hashicorp.com/validated-designs/consul-operating-guides-scaling |
| validated-design | https://developer.hashicorp.com/validated-designs/consul-operating-guides-standardization |
| validated-design | https://developer.hashicorp.com/validated-designs/consul-solution-design-guides-consul-enterprise-self-hosted |
| video (playlist) | https://www.youtube.com/playlist?list=PL81sUbsFNc5b8i2g2sB_tG-PuZxEdlDpK |
| video | https://www.youtube.com/watch?v=u8rF3lyMB4g |
### Observability (Grafana/Prometheus/Loki) — _decision 2026-05-29: NO crawl corpus._
Modeled as an **integration capability node**, not a product corpus. Rationale: hal-plus teaches
HashiCorp scenarios; the obs stack is the *lens* for observing Vault/Nomad/Consul/TFE, not a product
taught in its own right. Ingesting full upstream Grafana/Prometheus/Loki docs would bloat Qdrant and
dilute retrieval for the scenarios that matter.

Sourcing instead:
- **"How to observe product X"** → authoritative source is the **HashiCorp side** — each product's
  telemetry/monitoring docs, which already live inside the registered docs roots above (Vault telemetry,
  Nomad metrics, Consul telemetry, TFE monitoring). No new corpus needed.
- **hal-specific obs wiring** (dashboards hal ships, scrape config, log pipeline, ports) → belongs in a
  **hal-owned capability/behavior file**, not a crawled corpus.
- **Optional thin upstream reference** → at most a handful of curated deep-links tagged low-priority
  `reference` (not a crawl root), only if a real gap shows up.

---

## 9. VCS-Workflow Grounding (discovered) + Draft Specs

Source of truth: `hal/cmd/terraform/vcs-workflow.go` (read 2026-05-29). Command:
`hal terraform vcs-workflow enable` (aliases: `vcs`, `workspace`, `ws`; `-t primary|twin|both`).
This is the **VCS exemplar** that drives the capability-node + scenario-schema + MCP-tool specs.

### 9.1 What `hal tf vcs enable` actually does (ordered effects)
1. Verifies TFE core container running (`hal-tfe` for primary); else errors → "run `hal terraform create` first".
2. Ensures `hal-net`; boots/reuses shared **GitLab CE** container `hal-gitlab` (image `18.10.1-ce.0`).
3. Waits for GitLab API at `http://127.0.0.1:8080`; patches `hal-gitlab` `/etc/hosts` so `tfe.localhost`
   resolves to `hal-tfe-proxy` (webhook callback routing); relaxes GitLab local-webhook policy.
4. Creates/【reuses】 GitLab project (seeds `main.tf` + `.gitlab-ci.yml` on `main`).
5. Bootstraps TFE foundation (org/project, mints app API token via IACT, cached).
6. Creates TFE GitLab **OAuth client** (`service-provider: gitlab_community_edition`, fallback `gitlab`)
   + OAuth token id (PAT fallback on failure).
7. Creates/updates TFE **workspace** with `auto-apply:true`, `execution-mode:remote`,
   `queue-all-runs:true`, and `vcs-repo` linking the GitLab repo on branch `main`.
8. Prints GitLab repo URL + login + the manual next step.

### 9.2 Concrete default values (the capability-node data)
| field | primary default | twin default |
|---|---|---|
| TFE base URL | `https://tfe.localhost:8443` | twin layout UIURL |
| TFE org | `hal` | `tfeTwinOrg` |
| TFE project | `Dave` | `tfeTwinProject` |
| TFE workspace | `tfe-agent-demo` | `tfe-agent-demo-bis` |
| TFE admin | `haladmin` / `haladmin@localhost` / `hal9000FTW` | twin admin consts |
| Workspace URL | `https://tfe.localhost:8443/app/organizations/hal/workspaces/tfe-agent-demo` | twin equivalent |
| GitLab URL (host) | `http://127.0.0.1:8080` | same |
| GitLab internal host | `gitlab.localhost:8080` | same |
| GitLab login | `root` / `hal9000FTW` | same |
| GitLab project name/path | `tfe-agent-demo` | `tfe-agent-demo-bis` |
| Repo identifier | `root/tfe-agent-demo` | `root/tfe-agent-demo-bis` |
| Default branch | `main` (`--tfe-vcs-branch`) | `main` |
| GitLab CE image | `18.10.1-ce.0` | same |
| Seeded files | `main.tf` (null_resource hello), `.gitlab-ci.yml` (tf validate) | same |
| Tags regex | empty (off) by default | same |

> **Credentials are lab/demo, non-secret, ALREADY printed by the CLI** (`root / hal9000FTW`). Matches the
> §6 decision: OK to surface in hal+ answers. The MCP tool should return them in a `lab_credentials`
> field that is explicitly exempt from the redaction contract (lab-scoped only).

### 9.3 Observable result (the "Observe" step)
- Manual trigger: **push a commit to `main`** in the GitLab repo.
- Effect: GitLab webhook → TFE workspace run → **auto-apply** (queue-all-runs + auto-apply).
- Run link is **dynamic** → point user at the workspace runs page:
  `…/app/organizations/hal/workspaces/tfe-agent-demo/runs` (latest run is top).

### 9.4 `get_tfe_vcs_workflow_status` MCP tool contract (IMPLEMENTED, hal repo)
Read-only status tool, same envelope shape as existing `get_tfe_*` tools (`ops_api.go`,
`handleTFEVCSWorkflowStatus`). Returns live truth so hal+ never hardcodes the values in §9.2.
Shipped v1 `data` fields:
```jsonc
{
  "target": "primary",                       // primary | twin
  "gitlab": {
    "running": true,
    "url": "http://127.0.0.1:8080",
    "project_path": "root/tfe-agent-demo",
    "web_url": "http://127.0.0.1:8080/root/tfe-agent-demo",
    "default_branch": "main",
    "seeded_files": ["main.tf", ".gitlab-ci.yml"]
  },
  "tfe": {
    "running": true,
    "org": "hal",
    "project": "Dave",
    "workspace": "tfe-agent-demo",
    "workspace_url": "https://tfe.localhost:8443/app/organizations/hal/workspaces/tfe-agent-demo",
    "runs_url": "https://tfe.localhost:8443/app/organizations/hal/workspaces/tfe-agent-demo/runs",
    "vcs_linked": true,                       // oauth-token-id present on vcs-repo
    "auto_apply": true,
    "branch": "main"
  },
  "oauth_client": { "present": true, "service_provider": "gitlab_community_edition" },
  "lab_credentials": {                         // lab-scoped, redaction-exempt
    "gitlab": { "username": "root", "password": "hal9000FTW" },
    "tfe_admin": { "username": "haladmin", "password": "hal9000FTW" }
  },
  "ready": true,                               // gitlab.running && tfe.running && vcs_linked
  "next_steps": ["Push a commit to main in the GitLab repo to trigger an auto-applied TFE run."]
}
```
Open: confirm runs_url path format against this TFE version; decide whether to include latest-run
state (would need an extra TFE API call — nice-to-have, not required for v1).

**v1 shipped vs proposal:** `target`, `gitlab.*`, `tfe.{running,org,project,workspace,workspace_url,runs_url,auto_apply,branch}`,
`lab_credentials.*`, `ready`, plus a `notes` string are returned. Live booleans come from
`terraformRuntimeState()` (TFE), `global.IsContainerRunning(engine, "hal-gitlab")` (GitLab), and
`~/.hal/tfe-app-api-token` presence (used as the readiness proxy for the foundation/VCS wiring).
The deeper `vcs_linked` / `oauth_client` fields are **deferred** — they need a TFE API call against
the workspace; `ready = tfeRunning && gitlabRunning && tokenReady`. v1 covers the **primary** target
only (twin degrades gracefully). `next_steps` is carried in the envelope's typed `next_steps`
(title + expected_outcome) rather than a `data` array.

### 9.5 Draft — capability node + scenario shape (hal-plus side)
- **Capability nodes** (bounded, ~1 per product/feature) — for this exemplar:
  - `tfe` (provides: TFE runtime; `hal terraform create`)
  - `gitlab` (provides: VCS host; bootstrapped by the vcs-workflow command)
  - `tfe_vcs_workflow` (`depends_on: [tfe, gitlab]`; action: `hal terraform vcs-workflow enable`;
    status tool: `get_tfe_vcs_workflow_status`; manual trigger: push to `main`; observable: auto-applied run).
- **Scenario shape "VCS-driven workflow"** (one of 3–6 exemplars; the generator composes others):
  `Overview → Provision (hal tf create → hal tf vcs enable) → Access (GitLab+TFE URLs + lab creds from
  MCP) → Trigger (manual: push to main) → Observe (runs_url) → Under the hood (corpus: TF VCS docs +
  tutorial + VDD + video) → Learn more (typed cards)`.
- Location **DECIDED (Option 2, 2026-05-29):** one dedicated **`llm/scenarios/`** directory is the
  single source of truth for BOTH the capability graph (nodes + `dependsOn` edges + action command +
  status tool + manual trigger + observable) AND the 3–6 scenario shape templates. Capability nodes
  reference existing behavior-file `id`s (e.g. `terraform_workspace`) for answer content, but the graph
  edges are NOT duplicated into per-product frontmatter. Schema fields to finalize next.

---

## 10. Draft Schema — `llm/scenarios/` (Option 2) — FOR REVIEW

> Status: **proposal, no files created yet.** Review before implementation. Format = JSON (zero new
> deps; same approach as the existing `<!-- hal-plus-spec -->` behavior blocks). YAML possible if you
> prefer inline comments — say the word. Grounded entirely in the §9 VCS exemplar.

### 10.1 Directory layout
```
llm/scenarios/
  capabilities.json     # the capability GRAPH: every node + dependsOn edges (single source of truth)
  shapes/               # 3–6 scenario SHAPE templates (one file each)
    vcs-driven-workflow.md   # <!-- hal-plus-scenario {json} --> + narrative skeleton body
    ...
```
Two artifact types: a **capability graph** (pure data, one file) and **scenario shapes** (spec block +
markdown skeleton, like behaviors). Both live under `llm/scenarios/`. A new
`server/scenario-registry.mjs` loads them (mirrors `behavior-registry.mjs`).

### 10.2 Capability node schema (entries in `capabilities.json`)
```jsonc
{
  "id": "tfe_vcs_workflow",          // stable graph key
  "kind": "integration",             // product | feature | integration
  "label": "Terraform VCS-driven workflow",
  "product": "terraform",
  "behaviorId": "terraform_workspace",   // → existing behavior file for answer content (optional)
  "provides": "VCS-driven auto-apply of Terraform runs from a GitLab repo",
  "dependsOn": ["tfe", "gitlab"],        // THE EDGES (bounded authoring work lives here)
  "action": "hal terraform vcs-workflow enable",   // command that enables/creates this capability
  "statusTool": "get_tfe_vcs_workflow_status",     // MCP tool for live truth (null if none yet)
  "manualTrigger": "Push a commit to the main branch of the GitLab repo",
  "observable": {
    "what": "An auto-applied Terraform run appears in the TFE workspace",
    "linkFrom": "tfe.runs_url"           // dotted path into the statusTool payload
  },
  "access": {                            // which statusTool fields feed the 'Access' step
    "surfaces": ["gitlab.web_url", "tfe.workspace_url"],
    "credentials": ["lab_credentials.gitlab", "lab_credentials.tfe_admin"]
  },
  "sourceTags": { "product": "terraform", "feature": "vcs-workflow" }  // scopes Qdrant retrieval
}
```
- `tfe` and `gitlab` are simpler nodes (kind `product`/`integration`, their own `action` =
  `hal terraform create` / bootstrapped-by-vcs-workflow, `statusTool` = `get_tfe_status` / none).
- The composer **walks `dependsOn`** to assemble the full Provision sequence (so `tfe` first, then the
  workflow) — edges are authored once, sequences are derived.

### 10.3 Scenario shape schema (`shapes/<id>.md`, spec block + body)
```jsonc
// <!-- hal-plus-scenario
{
  "id": "vcs-driven-workflow",
  "title": "VCS-driven workflow",
  "intent": {                            // routes a prompt to this shape (reuses behavior match style)
    "any": ["understand vcs", "end to end", "walk me through", "how does ... workflow", "vcs driven"],
    "all": []
  },
  "appliesTo": { "capabilityKind": "integration", "requires": ["manualTrigger", "observable"] },
  "slots": [                             // ordered narrative sections + where each gets its data
    { "name": "overview",     "source": "model+corpus" },
    { "name": "provision",    "source": "graph.action(dependsOn-walk)" },
    { "name": "access",       "source": "mcp.statusTool(access.surfaces+credentials)" },
    { "name": "trigger",      "source": "graph.manualTrigger" },
    { "name": "observe",      "source": "mcp.statusTool(observable.linkFrom)" },
    { "name": "under_the_hood","source": "corpus", "coverage": ["docs","tutorial","validated-design","video"] },
    { "name": "learn_more",   "source": "corpus.cards(group_by=source_type)" }
  ],
  "grounding": {
    "commandsFrom": ["graph", "mcp"],    // never invent commands
    "linksFrom": ["mcp", "corpus"],      // never invent URLs
    "liveFactsFrom": ["mcp"],            // creds/endpoints/run links only from MCP
    "prose": "model-owned (verbatim constraint loosened for this route)"
  }
}
// -->
```
**Body (markdown):** the exemplar narrative skeleton the composer imitates for *unseen* combos — this
is what makes VCS "one exemplar, not the catalog." 3–6 such shapes cover the long tail; the generator
fills slots from any capability subgraph that matches `appliesTo`.

### 10.4 How an answer is generated (flow)
1. Route detects scenario intent → pick matching **shape** (`intent`) + resolve target **capability**
   (+ its `dependsOn` subgraph).
2. Call each capability's `statusTool` (live facts, lab creds, links).
3. Retrieve corpus filtered by `sourceTags` with the shape's `coverage` requirement (≥1 per source_type).
4. Hand the model: shape body + filled slots + grounded facts + corpus chunks → it composes prose,
   fenced by `grounding` rails (commands/links/facts only from graph+MCP+corpus).

### 10.5 Schema decisions — RESOLVED (2026-05-29)
- **Format: JSON** (zero new deps; consistent with `<!-- hal-plus-spec -->` behavior blocks). ✔
- **Single `capabilities.json`** for the whole graph (clean while small; split later only if it grows). ✔
- **7 slots confirmed:** Overview → Provision → Access → Trigger → Observe → Under the hood → Learn more
  (matches §4D D1). ✔
- **Dotted-path convention confirmed** (`tfe.runs_url`) for `linkFrom`/`access`/credentials, resolved
  against the §9.4 `get_tfe_vcs_workflow_status` payload. ✔

Schema is now FROZEN for v1. Next: create `llm/scenarios/capabilities.json` + `shapes/vcs-driven-workflow.md`
+ `server/scenario-registry.mjs` (per §10.1), grounded in §9.

### 10.6 Files created (2026-05-29) — scaffolding landed
- `llm/scenarios/capabilities.json` — graph with nodes `tfe`, `gitlab`, `tfe_vcs_workflow`
  (`dependsOn: [tfe, gitlab]`). Fields per §10.2.
- `llm/scenarios/shapes/vcs-driven-workflow.md` — `<!-- hal-plus-scenario {json} -->` block (7 slots,
  intent, grounding rails) + markdown narrative skeleton. Fields per §10.3.
- `server/scenario-registry.mjs` — loader mirroring `behavior-registry.mjs`. Exports:
  `loadCapabilityGraph`, `loadScenarioShapes`, `resolveScenarioContext(prompt)` (intent scoring +
  primary-capability resolution), `buildProvisionSequence` (DFS dependsOn walk, parents-first, deduped),
  `listRequiredStatusTools`. Smoke-tested: prompt → shape `vcs-driven-workflow`, primary
  `tfe_vcs_workflow`, provision order `[tfe, gitlab, tfe_vcs_workflow]`, status tools
  `[get_tfe_status, get_tfe_vcs_workflow_status]`, non-match → null.
- **Known follow-up:** `gitlab` and `tfe_vcs_workflow` share the same `action`
  (`hal terraform vcs-workflow enable`), so the raw provision list repeats it — the answer composer
  must dedupe consecutive identical commands. NOT yet wired into `server/index.mjs` /api/chat (no
  Scenario route yet) and MCP `get_tfe_vcs_workflow_status` is now IMPLEMENTED (hal side, §9.4).

### 10.7 Graph + shapes expanded (2026-05-29) — generalization proof
Added two more grounded scenarios so the schema is exercised across products + shape rhythms (user:
"should we not add 2 other scenarios"). All facts read from hal source, not invented.
- **Capabilities now 6:** `tfe`, `gitlab`, `tfe_vcs_workflow`, **`tfe_api_workflow`** (dependsOn `tfe`;
  `hal terraform api-workflow enable`; ephemeral TFX helper `hal-tfe-api`; src `cmd/terraform/api-workflow.go`),
  **`vault`** (`hal vault create`; `get_vault_status`), **`vault_database`** (dependsOn `vault`;
  `hal vault database enable`; MariaDB `hal-vault-mariadb`, mount `database/`, role `dba-role` ttl 2m/2h;
  src `cmd/vault/database.go`).
- **Shapes now 3:** `vcs-driven-workflow` (trigger→observe loop), **`dynamic-secrets`** (request &
  consume — Trigger = `vault read database/creds/dba-role`, Observe = JIT cred + lease/TTL),
  **`cli-driven-workflow`** (API/CLI-driven; reuses `tfe` node — proves subgraph composition).
- **Schema finding (important):** only `get_tfe_status` (and the now-implemented `get_tfe_vcs_workflow_status`)
  return **structured** payloads supporting dotted-path `linkFrom`/`access`. `get_vault_status`,
  `get_vault_database_status`, `get_tfe_api_workflow_status` go through `handleStatusCommandTool` →
  **TEXT** status only. So `observable.linkFrom` is `null` for those nodes and the shape body must
  describe endpoints from capability `notes`, not fabricate field paths. Schema already tolerates this
  (linkFrom nullable, surfaces/credentials empty arrays). Cross-node referencing works:
  `tfe_api_workflow` pulls `tfe.workspace_url` from its dependsOn `tfe` node's structured status.
- **Smoke-tested:** 3 prompts → correct shape + primary + dependsOn-composed provision + deduped tools;
  off-topic → null. Graph reuse of `tfe` confirmed for the API workflow.

### 10.8 Scenario route wired into `/api/chat` (2026-05-29) — milestone 1 landed
The Scenario route is now live in `server/index.mjs` (user: "yes go with 1"). Milestone 1 needs only
Ollama + hal MCP + the existing MiniSearch corpus — **no Qdrant**.
- **New registry exports** (`server/scenario-registry.mjs`):
  - `buildProvisionCommands(context)` → ordered hal commands from the dependsOn walk, **consecutive
    duplicates collapsed** (fixes the gitlab/tfe_vcs_workflow shared-command repeat).
  - `buildScenarioPromptSupplement(context, factsByTool)` → pure builder. Emits the shape `body` +
    per-capability grounded facts (provision command, manualTrigger, observable, access field names,
    lab-default `notes`, and the live MCP status block) + grounding rules. Missing tools render as
    "tool unavailable (rely on the capability notes…)".
- **New helper** `gatherScenarioMcpFacts(toolNames)` in `index.mjs`: calls each status tool via
  `halMcpClient.callTool`, returns `{ [tool]: { ok, structured, text } }`. `structured` =
  `structuredContent.data ?? structuredContent`. Tools that are unavailable at call time resolve to
  `{ ok:false }` — graceful degrade. (`get_tfe_vcs_workflow_status` is now implemented; see §9.4.)
- **Route placement (Route S):** at the TOP of `/api/chat`, right after `prompt` is resolved and BEFORE
  the behavior/deterministic pipeline. Gate: fires **only** when `resolveScenarioContext(prompt)` returns
  BOTH a `shape` AND a `primary` capability, so simple status/factual asks are never hijacked. On match it
  gathers MCP facts + docs (`docsForPromptWithFallback(prompt, null, messages)`, MiniSearch corpus), builds
  a scenario system prompt (persona + 7-section structure + supplement + doc supplement), and streams
  Ollama via `proxyOllamaStreamToSSE(res, …, { headersAlreadySet:true })`. SSE meta = `{ source:"scenario",
  mcpServer:"hal", topic:<shapeId>, capability:<primaryId> }`. Existing A/B/C routes untouched (early return).
- **Validated:** standalone smoke test — "walk me through the vcs driven workflow with TFE" → shape
  `vcs-driven-workflow`, primary `tfe_vcs_workflow`, tools `[get_tfe_status, get_tfe_vcs_workflow_status]`,
  supplement embeds the live structured `get_tfe_status` fact + "tool unavailable" for the missing one;
  off-topic → null. `get_errors` clean on both files.
- **Next:** run `npm run dev`, try the prompt in the UI against live MCP, then validate grounding rails
  before investing in Qdrant (milestone 2). Doc-URL pinning per scenario primary behaviorId is a deferred
  enhancement (currently passes `null` context to doc search).
