# HAL Plus Local Doc Search Design

## Purpose
Create a Vault Lens-level documentation retrieval experience in HAL Plus, while keeping the local footprint minimal and avoiding extra always-on infrastructure.

This document captures current requirements and implementation direction for a local-first doc search and grounding system.

## User Needs Summary
- Retrieval quality should feel highly legitimate and source-grounded.
- Responses should pull relevant sections from HashiCorp docs and personal docs.
- Local footprint must stay small because HAL CLI already depends on heavy local tooling.
- Prefer npm/Node-based integration with current HAL Plus architecture.
- Avoid introducing a separate vector database daemon if possible.
- Keep behavior HAL-first, educational, and operationally reliable.

## Non-Goals
- Building a cloud-hosted RAG platform.
- Adding mandatory remote dependencies for retrieval.
- Replacing HAL MCP as runtime source of truth.

## Current HAL Plus Baseline
- Behavior-pack markdown retrieval and matching exists.
- HAL MCP grounding exists for runtime and command truth.
- /api/docs currently ranks small candidate sets, but does not do full corpus chunk retrieval.

## Proposed Phase 1 (Low Footprint, High Value)
Implement local hybrid retrieval inside the HAL Plus Node server process:

1. Corpus ingestion and chunking
- Sources:
  - HAL Plus behavior packs
  - Selected HAL docs folders
  - User-provided personal docs folders
- Chunking:
  - Markdown-aware chunking by headings and paragraphs
  - Include metadata: source path, title, section heading, product tags, last modified time

2. Local lexical index (required)
- Use a lightweight JS index library (for example minisearch) for BM25-style retrieval.
- Persist index artifacts on disk (JSON files) under a local cache directory.

3. Embedding rerank (optional but recommended in Phase 1)
- For top N lexical matches, request embeddings from local Ollama embedding model.
- Re-rank candidates by semantic similarity.
- No vector DB service; vectors are computed/stored locally in files.

4. Grounding integration
- Send top K chunks to chat as explicit grounding context with citations.
- Keep HAL MCP runtime facts authoritative for operational claims.
- If retrieval confidence is low, respond with uncertainty and verification commands.

## Why This Matches the Goal
- Similar retrieval quality trajectory to vector workflows.
- No extra database service to install or run.
- Reuses existing local model stack (Ollama) and npm runtime.
- Keeps architecture simple and debuggable.

## Footprint Strategy
Primary rule: no new always-on process.

Preferred runtime profile:
- One Node API process (already present)
- One Ollama process (already present)
- On-disk index files only

Optional profile switches:
- Lexical-only mode for smallest footprint
- Hybrid mode (lexical + embedding rerank) for better quality

## Data Sources and Scope
Current pilot source sets (Terraform + Vault):
- Terraform:
  - https://developer.hashicorp.com/terraform/enterprise
  - https://www.hashicorp.com/en/blog/which-terraform-workflow-should-i-use-vcs-cli-or-api
  - https://developer.hashicorp.com/validated-patterns/terraform
- Vault:
  - https://developer.hashicorp.com/vault
  - https://developer.hashicorp.com/validated-patterns/vault

Initial source candidates:
- hal-plus/llm/products/**/*.md
- ../hal/docs/**/*.md (selected subtrees)
- User-curated personal docs directory (path configured by env var)

Future expansion:
- Product-specific official docs snapshots
- Curated internal runbooks and troubleshooting notes

Immediate implementation note:
- The server retrieval path should stay product-aware (at least Terraform and Vault), including subpage discovery from product root pages and product-specific relevance boosts.

## Ranking and Retrieval Pipeline
1. Query normalization
2. Product and intent hints extraction
3. Lexical retrieval top N
4. Optional embedding rerank top N -> top K
5. Diversity pass to avoid duplicate near-identical chunks
6. Citation assembly for UI and prompt grounding

## HAL Plus Integration Points
- New server module: retrieval engine and index manager
- /api/docs endpoint: return ranked citations and summaries from retrieval results
- /api/chat endpoint: inject compact grounded context block before LLM generation
- Keep deterministic and MCP-first routing unchanged for operational safety

## Guardrails
- Never present retrieved text as runtime truth unless HAL MCP confirms it.
- Distinguish clearly:
  - Static doc guidance
  - Live runtime status
- Prefer HAL commands over raw commands in final answers.
- If docs conflict or confidence is low, explicitly say unknown and provide checks.
- Keep user-facing output concise by default with links/citations.

## Configuration
Suggested env vars:
- HAL_DOC_SEARCH_ENABLED=true|false
- HAL_DOC_SEARCH_MODE=lexical|hybrid
- HAL_DOC_SEARCH_PERSONAL_DIR=/absolute/path/to/personal/docs
- HAL_DOC_SEARCH_CACHE_DIR=.hal-plus-cache/doc-search
- HAL_DOC_SEARCH_TOP_N=20
- HAL_DOC_SEARCH_TOP_K=6
- HAL_DOC_SEARCH_EMBED_MODEL=nomic-embed-text

## Index Lifecycle
- Build on demand at startup if missing.
- Rebuild when source file mtime changes.
- Provide manual rebuild command endpoint or npm script.
- Keep index format versioned for future schema changes.

## Observability and Debugging
- Add debug metadata per answer:
  - number of chunks considered
  - selected sources
  - retrieval mode (lexical or hybrid)
- Add safe server logs for retrieval latency and failures.

## Risks and Mitigations
Risk: embedding model adds local model weight.
- Mitigation: keep lexical-only fallback and opt-in hybrid mode.

Risk: stale index after docs change.
- Mitigation: mtime-based incremental refresh plus manual rebuild.

Risk: hallucinated blending across chunks.
- Mitigation: strict citation-first prompt format and MCP runtime checks.

## Open Decisions For User Input
- Personal docs canonical folder path(s)
- Allowed document types beyond markdown
- Maximum local cache size budget
- Citation format preference in UI
- Default mode on first install (lexical or hybrid)

## Manual Guardrail Section (User Editable)
Add strict rules here that HAL Plus must enforce in retrieval and answer generation.

- Guardrail 1:
- Guardrail 2:
- Guardrail 3:

## Manual Quality Bar Section (User Editable)
Add concrete examples of good and bad answers.

- Good example:
- Bad example:
- Mandatory evidence format:

## Implementation Readiness Checklist
- [ ] Finalize source folders
- [ ] Finalize guardrails
- [ ] Finalize default retrieval mode
- [ ] Approve env var contract
- [ ] Approve citation format

## Next Step After This Document Is Updated
Implement Phase 1 in HAL Plus:
- lexical retrieval baseline
- optional Ollama embedding rerank
- chat grounding injection with citations
- minimal UX changes for doc cards
