# HAL Plus Local Doc Search Design

## Purpose
Give hal+ a "dedicated HashiCorp Google" experience: users get relevant doc sections cited in answers simply by having a conversation — no keyword typing required.

This document is the source of truth for the doc search architecture implemented in `server/doc-search.mjs`.

## Design Goals
- Section-level retrieval precision: answers cite `href#anchor`, not just homepage URLs.
- Conversation-driven: query is built from last 4 user turns, not just the current message.
- MCP-independent: doc retrieval works regardless of which MCPs are connected.
- Minimal footprint by default: one Node process + one Ollama process + on-disk index files; no mandatory extra daemon.
- Optional Qdrant vector backend for corpus scale, opt-in and degrading gracefully to local.

## Non-Goals
- Building a cloud-hosted RAG platform.
- Making any remote dependency *mandatory* for retrieval (Qdrant is opt-in; local is the default and the fallback).
- Replacing HAL MCP as runtime source of truth.

## Architecture

### Build phase (async, runs at startup, cached 24h)
1. For each product (currently `terraform`, `vault`), BFS-crawl doc roots up to depth 2.
2. Each page: fetch HTML (disk-cached 12h) → parse heading hierarchy → extract section chunks with `href#anchor`.
3. Build MiniSearch BM25 index over all chunks.
4. Persist to `.hal-plus-cache/doc-search/<product>/` (chunks.json + index.json + manifest.json).

Server starts immediately. Corpus builds run in background — stale or missing corpora do not block startup.

### Query phase (each chat turn)
1. Build enriched query from last 4 user conversation turns concatenated (not just current prompt).
2. Product filter from conversation context (`context.primary.product` or `context.product.product`).
3. MiniSearch BM25 → top 20 candidates.
4. Ollama embedding rerank (`nomic-embed-text`) → top 6 chunks with section-level hrefs.
5. Inject chunks into LLM system prompt as grounding via `buildDocSearchPromptSupplement`.

### Chunk structure
```
{
  id, type ("text"|"code"), product, sourceTitle, sectionTitle,
  headingPath,   // e.g. "Vault Docs > Auth Methods > JWT Auth"
  href,          // e.g. https://developer.hashicorp.com/vault/docs/auth/jwt#configuration
  kind, language, content
}
```

## Footprint
- No new always-on process.
- Runtime: one Node API process + one Ollama process (both already present).
- Disk: `.hal-plus-cache/doc-search/` — index JSON files per product.

Modes:
- `HAL_DOC_SEARCH_MODE=hybrid` (default): BM25 + embedding rerank
- `HAL_DOC_SEARCH_MODE=lexical`: BM25 only (smaller footprint, lower precision)

## Retrieval backends (`HAL_RAG_BACKEND`)
Retrieval is pluggable. Both backends share the same crawl/chunking and the same
embedder (`nomic-embed-text`, 768-dim), so they are vector-compatible.

- **`local` (default)** — MiniSearch BM25 top-N → Ollama embedding rerank top-K.
  No extra service. This is the dev default and the safety fallback.
- **`qdrant`** — embed the query, run a product-filtered vector search against a
  pre-pushed Qdrant collection, apply a min-score floor + per-source-page
  diversity cap. Implemented in `retrieveViaQdrant` in `doc-search.mjs` via the
  shared `server/qdrant-client.mjs` REST helper. If Qdrant is unreachable or
  returns nothing, retrieval **silently falls back to the local path** so nothing
  breaks.

### Qdrant collection contract
- Collection `hal-plus` (env `HAL_QDRANT_COLLECTION`).
- Vectors `{ size: 768, distance: Cosine }`.
- Keyword payload indexes on `product` and `source_type` for filtered search.
- Point id = deterministic UUID from `md5(chunkId)` → idempotent re-ingest.
- Payload carries the full chunk (content, href, headingPath, sourceTitle,
  sectionTitle, type, language, kind) plus `product`, `source_type`
  (`docs`/`tutorial`/… derived from href) and `source_page`.

### Local Qdrant workflow (dev, pre-snapshot)
```
npm run qdrant:up        # podman compose -f docker-compose.qdrant.yml up -d (qdrant v1.13.6, 6333/6334)
npm run push-to-qdrant   # embed on-disk corpus chunks → upsert (idempotent; --recreate / --product <id>)
npm run dev:qdrant       # dev server with HAL_RAG_BACKEND=qdrant
npm run qdrant:down
```
Ingest reuses the local on-disk corpus (`.hal-plus-cache/doc-search/<product>/chunks.json`)
as the source of chunks, so the crawl runs once and feeds both backends. Baking a
corpus snapshot image for release is a later step (not part of this slice).

## Product tree
Defined in `PRODUCT_TREE` constant in `doc-search.mjs`. Currently:
- **terraform**: roots at `/terraform/enterprise` + `/terraform/cloud-docs`, depth 2, max 300 pages
- **vault**: roots at `/vault/docs` + `/vault/tutorials`, depth 2, max 300 pages

To add a product (e.g. Nomad, Consul, Boundary): add an entry to `PRODUCT_TREE`. No other changes needed.

## MCP relationship
- MCP owns: live runtime truth — current commands, endpoints, runtime state.
- Docs own: explanatory narrative — why hal does this, what the options mean, what to do next.
- These are complementary layers. Doc retrieval is not gated on MCP availability.

## Guardrails
- Never present retrieved text as runtime truth unless HAL MCP confirms it.
- `buildDocSearchPromptSupplement` explicitly labels chunks as "static guidance, not runtime truth".
- Prefer HAL commands over raw commands in final answers.
- If docs conflict or retrieval confidence is low, say unknown and provide HAL check commands.

## Corpus rebuild control
- `DOC_SEARCH_CORPUS_VERSION = "2"` — bump to force a full rebuild on next startup even if TTL has not expired.
- `HAL_DOC_SEARCH_CORPUS_TTL_MS` — default 24h.
- `HAL_DOC_SEARCH_FETCH_TTL_MS` — default 12h for individual page HTML cache.
- `HAL_DOC_SEARCH_CRAWL_DEPTH` — default 2.
- `HAL_DOC_SEARCH_MAX_PAGES` — default 80 per product.

## Configuration env vars
| Var | Default | Purpose |
|---|---|---|
| `HAL_DOC_SEARCH_ENABLED` | `true` | Enable/disable doc search entirely |
| `HAL_DOC_SEARCH_MODE` | `hybrid` | `hybrid` (BM25+embed) or `lexical` (BM25 only) |
| `HAL_DOC_SEARCH_TOP_N` | `20` | BM25 candidates before rerank |
| `HAL_DOC_SEARCH_TOP_K` | `6` | Final chunks injected into prompt |
| `HAL_DOC_SEARCH_EMBED_MODEL` | `nomic-embed-text` | Ollama model for embeddings |
| `HAL_DOC_SEARCH_CACHE_DIR` | `.hal-plus-cache/doc-search` | Root cache directory |
| `HAL_DOC_SEARCH_CORPUS_TTL_MS` | `86400000` | Corpus rebuild interval (24h) |
| `HAL_DOC_SEARCH_FETCH_TTL_MS` | `43200000` | Per-page HTML cache TTL (12h) |
| `HAL_DOC_SEARCH_CRAWL_DEPTH` | `2` | Crawl depth from product roots |
| `HAL_DOC_SEARCH_MAX_PAGES` | `300` | Max pages crawled per product |
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
