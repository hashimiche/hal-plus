// doc-search.mjs — v2
//
// Pre-built, section-level corpus with MiniSearch BM25 + Ollama embedding rerank.
// Completely MCP-independent: retrieval is driven by conversation context alone,
// not by what MCP happened to return. Works regardless of which MCPs are connected.
//
// Architecture:
//   Build phase (async at startup, cached 24h on disk):
//     crawl product roots -> multi-level subpages -> heading-aware chunks -> MiniSearch index
//   Query phase (each chat turn):
//     conversation context query -> MiniSearch BM25 top-N -> Ollama embed rerank top-K
//
// Exports:
//   initCorpus()                         -- call once at server startup
//   retrieveDocsForPrompt(p, ctx, opts)  -- main retrieval entry point
//   buildDocSearchPromptSupplement(res)  -- format chunks for LLM system prompt

import fs from "fs";
import path from "path";
import crypto from "crypto";
import MiniSearch from "minisearch";

// Configuration

const DOC_SEARCH_ENABLED =
  String(process.env.HAL_DOC_SEARCH_ENABLED || "true").toLowerCase() !== "false";
const DOC_SEARCH_MODE = String(process.env.HAL_DOC_SEARCH_MODE || "hybrid").toLowerCase();
const DOC_SEARCH_TOP_N = Number(process.env.HAL_DOC_SEARCH_TOP_N || 20);
const DOC_SEARCH_TOP_K = Number(process.env.HAL_DOC_SEARCH_TOP_K || 6);
const DOC_SEARCH_EMBED_MODEL =
  process.env.HAL_DOC_SEARCH_EMBED_MODEL || "nomic-embed-text";
const DOC_SEARCH_CACHE_DIR = path.resolve(
  process.cwd(),
  process.env.HAL_DOC_SEARCH_CACHE_DIR || ".hal-plus-cache/doc-search"
);
const DOC_SEARCH_CORPUS_TTL_MS = Number(
  process.env.HAL_DOC_SEARCH_CORPUS_TTL_MS || 24 * 60 * 60 * 1000
);
const DOC_SEARCH_FETCH_TTL_MS = Number(
  process.env.HAL_DOC_SEARCH_FETCH_TTL_MS || 12 * 60 * 60 * 1000
);
const DOC_SEARCH_CRAWL_DEPTH = Number(process.env.HAL_DOC_SEARCH_CRAWL_DEPTH || 2);
const DOC_SEARCH_MAX_PAGES = Number(process.env.HAL_DOC_SEARCH_MAX_PAGES || 80);
const DOC_SEARCH_CORPUS_VERSION = "3";

const DOC_ALLOWED_HOSTS = new Set([
  "developer.hashicorp.com",
  "www.hashicorp.com",
  "hashicorp.com",
]);

// Product tree definitions
// roots    -- entry points; BFS crawl starts here
// prefixes -- path must start with one of these to be followed
// depth    -- crawl depth per product (0 = root only, 2 = root + 2 levels deep)
// maxPages -- max pages to crawl per product

const PRODUCT_TREE = {
  terraform: {
    label: "Terraform",
    roots: [
      "https://developer.hashicorp.com/terraform/enterprise",
      "https://developer.hashicorp.com/terraform/cloud-docs",
    ],
    prefixes: ["/terraform"],
    depth: DOC_SEARCH_CRAWL_DEPTH,
    maxPages: DOC_SEARCH_MAX_PAGES,
    kind: "official",
  },
  vault: {
    label: "Vault",
    roots: [
      // Root pages — establish top-level nav and link graph
      "https://developer.hashicorp.com/vault/docs",
      "https://developer.hashicorp.com/vault/tutorials",
      // Explicit seeds for deep subtrees that matter for HAL workflows
      // These are depth=2 from the roots in practice but unreliable via nav links
      "https://developer.hashicorp.com/vault/docs/auth",
      "https://developer.hashicorp.com/vault/docs/auth/jwt",
      "https://developer.hashicorp.com/vault/docs/auth/oidc",
      "https://developer.hashicorp.com/vault/docs/auth/kubernetes",
      "https://developer.hashicorp.com/vault/docs/auth/ldap",
      "https://developer.hashicorp.com/vault/docs/secrets/databases",
      "https://developer.hashicorp.com/vault/docs/audit",
      "https://developer.hashicorp.com/vault/docs/deploy/kubernetes/vso",
      "https://developer.hashicorp.com/vault/docs/internals/telemetry",
    ],
    prefixes: ["/vault"],
    depth: DOC_SEARCH_CRAWL_DEPTH,
    maxPages: DOC_SEARCH_MAX_PAGES,
    kind: "official",
  },
};

// In-memory corpus state
// productId -> { index: MiniSearch, chunkMap: Map<id, chunk>, builtAt: number }
const corpusState = new Map();
const buildInProgress = new Set();

// File path helpers

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeProductId(productId) {
  return String(productId || "").replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
}

function productCacheDir(productId) {
  return path.join(DOC_SEARCH_CACHE_DIR, safeProductId(productId));
}

function manifestPath(productId) {
  return path.join(productCacheDir(productId), "manifest.json");
}

function chunksFilePath(productId) {
  return path.join(productCacheDir(productId), "chunks.json");
}

function indexFilePath(productId) {
  return path.join(productCacheDir(productId), "index.json");
}

function fetchCacheFilePath(url) {
  const hash = crypto.createHash("sha256").update(String(url || "")).digest("hex");
  return path.join(DOC_SEARCH_CACHE_DIR, "fetch-cache", `${hash}.json`);
}

// URL / HTML utilities

function safeParseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function normalizePageHref(parsedUrl) {
  return `${parsedUrl.origin}${parsedUrl.pathname}`.replace(/\/+$/, "");
}

function isDocPathname(pathname, prefixes) {
  const norm = String(pathname || "").replace(/\/+$/, "");
  return prefixes.some((prefix) => norm.startsWith(prefix));
}

function isAsset(pathname) {
  return /\.(png|jpg|jpeg|gif|svg|webp|pdf|zip|css|js|woff|woff2|ttf|eot)$/i.test(
    String(pathname || "")
  );
}

function decodeEntities(input) {
  return String(input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(input) {
  return decodeEntities(
    String(input || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function extractPageTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "Untitled";
  return stripHtml(match[1]).slice(0, 160) || "Untitled";
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const regex = /<a\b[^>]*\shref=["']([^"'#][^"']*?)["'][^>]*>/gi;
  let m;
  while ((m = regex.exec(String(html || ""))) !== null) {
    try {
      const resolved = new URL(String(m[1] || "").trim(), baseUrl);
      links.push(resolved);
    } catch {
      // skip malformed href
    }
  }
  return links;
}

// Raw fetch with disk cache

async function fetchWithCache(url) {
  const parsed = safeParseUrl(url);
  if (!parsed || !DOC_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`URL not in allowed hosts: ${url}`);
  }

  ensureDir(path.join(DOC_SEARCH_CACHE_DIR, "fetch-cache"));
  const filePath = fetchCacheFilePath(url);

  if (fs.existsSync(filePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Date.now() - Number(cached?.fetchedAt || 0) < DOC_SEARCH_FETCH_TTL_MS) {
        return cached;
      }
    } catch {
      // corrupt cache entry -- fall through to refetch
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": "HAL-Plus-DocSearch/2 (educational lab tool)" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  const body = await response.text();
  const contentType = response.headers.get("content-type") || "text/html";
  const payload = { url, contentType, body, fetchedAt: Date.now() };

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
  } catch {
    // best-effort disk write; continue without caching
  }

  return payload;
}

// Heading-aware chunking
//
// For each heading (H1-H6) in the page HTML:
//   - Build a hierarchical heading path: "Vault Docs > Auth Methods > JWT Auth"
//   - Extract the content block between this heading and the next
//   - Split long content into sub-chunks (max ~900 chars each)
//   - Extract code blocks within the section as separate typed chunks
//   - Emit a fragment href pointing directly to the section anchor
//
// This gives section-level precision: callers get href#anchor, not just the page URL.

function normalizeAnchor(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function hrefWithFragment(pageHref, anchor) {
  const clean = normalizeAnchor(anchor);
  if (!clean) return pageHref;
  const base = String(pageHref || "").split("#")[0];
  return `${base}#${clean}`;
}

function splitIntoTextChunks(text, maxLen) {
  const max = maxLen || 900;
  const paragraphs = String(text || "")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length <= max) {
      buffer = candidate;
      continue;
    }
    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }
    if (para.length <= max) {
      buffer = para;
      continue;
    }
    for (let i = 0; i < para.length; i += max) {
      chunks.push(para.slice(i, i + max));
    }
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

function chunksFromPage(html, pageHref, sourceTitle, productId, kind) {
  const pageKind = kind || "official";
  const source = String(html || "");
  const chunks = [];

  const headingRegex = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;
  const matches = [];
  let m;
  while ((m = headingRegex.exec(source)) !== null) {
    matches.push({
      tag: String(m[1]).toLowerCase(),
      attrs: String(m[2] || ""),
      innerHtml: String(m[3] || ""),
      index: m.index,
      endIndex: headingRegex.lastIndex,
    });
  }

  if (matches.length === 0) return chunks;

  // Stack to track heading hierarchy for building headingPath.
  const headingStack = [];

  for (let i = 0; i < matches.length; i++) {
    const h = matches[i];
    const level = parseInt(h.tag[1], 10);
    const sectionTitle = stripHtml(h.innerHtml).replace(/\s+/g, " ").trim();
    if (!sectionTitle) continue;

    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1].level >= level
    ) {
      headingStack.pop();
    }
    headingStack.push({ level, title: sectionTitle });

    const headingPath = headingStack.map((s) => s.title).join(" > ");

    const idMatch = h.attrs.match(/\sid=["']([^"']+)["']/i);
    const anchorLinkMatch = h.innerHtml.match(/href=["']#([^"']+)["']/i);
    const nestedIdMatch = h.innerHtml.match(/\sid=["']([^"']+)["']/i);
    const anchor =
      idMatch?.[1] || anchorLinkMatch?.[1] || nestedIdMatch?.[1] || sectionTitle;
    const href = hrefWithFragment(pageHref, anchor);

    const next = matches[i + 1];
    const sectionHtml = source.slice(h.endIndex, next ? next.index : source.length);
    const sectionText = stripHtml(sectionHtml).trim();

    if (sectionText) {
      const textParts = splitIntoTextChunks(sectionText, 900);
      for (let ci = 0; ci < textParts.length; ci++) {
        const content = textParts[ci];
        if (!content) continue;
        chunks.push({
          id: `${pageHref}#h${i + 1}-t${ci + 1}`,
          type: "text",
          product: productId,
          sourceTitle,
          sectionTitle,
          headingPath,
          href,
          kind: pageKind,
          language: "text",
          content,
        });
      }
    }

    // Code blocks within this section.
    const codeRegex =
      /<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;
    let cMatch;
    let codeIndex = 0;
    while ((cMatch = codeRegex.exec(sectionHtml)) !== null) {
      const attrs = String(cMatch[1] || "");
      const raw = decodeEntities(String(cMatch[2] || ""))
        .replace(/\r/g, "")
        .trim();
      if (!raw || raw.length < 20) continue;
      const langMatch =
        attrs.match(/language-([a-z0-9_-]+)/i) ||
        attrs.match(/lang(?:uage)?=["']?([a-z0-9_-]+)/i);
      const lang = langMatch ? String(langMatch[1]).toLowerCase() : "text";
      chunks.push({
        id: `${pageHref}#h${i + 1}-c${++codeIndex}`,
        type: "code",
        product: productId,
        sourceTitle,
        sectionTitle,
        headingPath,
        href,
        kind: pageKind,
        language: lang,
        content: raw.slice(0, 1200),
      });
    }
  }

  return chunks;
}

// Multi-level BFS crawler
//
// Starts from each product root, follows same-host/same-prefix links up to
// `depth` levels deep, capped at `maxPages` pages. Each page is fetched once
// (disk-cached) and chunked with chunksFromPage().

async function crawlProduct(productId, productDef) {
  const visited = new Set();
  const queue = productDef.roots.map((root) => ({ url: root, depth: 0 }));
  const allChunks = [];

  while (queue.length > 0 && visited.size < productDef.maxPages) {
    const { url, depth } = queue.shift();
    const pageHref = String(url).split("#")[0].replace(/\/+$/, "");

    if (visited.has(pageHref)) continue;

    const parsed = safeParseUrl(pageHref);
    if (!parsed) continue;
    if (!DOC_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) continue;
    if (!isDocPathname(parsed.pathname, productDef.prefixes)) continue;
    if (isAsset(parsed.pathname)) continue;

    visited.add(pageHref);

    let fetched;
    try {
      fetched = await fetchWithCache(pageHref);
    } catch {
      continue;
    }

    const html = String(fetched?.body || "");
    if (!html) continue;

    const title = extractPageTitle(html);
    const pageChunks = chunksFromPage(html, pageHref, title, productId, productDef.kind);
    allChunks.push(...pageChunks);

    if (depth < productDef.depth) {
      const links = extractLinksFromHtml(html, pageHref);
      for (const link of links) {
        if (!DOC_ALLOWED_HOSTS.has(link.hostname.toLowerCase())) continue;
        if (!isDocPathname(link.pathname, productDef.prefixes)) continue;
        if (isAsset(link.pathname)) continue;
        const childHref = normalizePageHref(link);
        if (!visited.has(childHref)) {
          queue.push({ url: childHref, depth: depth + 1 });
        }
      }
    }
  }

  return allChunks;
}

// MiniSearch index
//
// Fields indexed: sectionTitle (boost 2.5), headingPath (boost 1.8), content (boost 1)
// storeFields are returned by search results and used to reconstruct display data.
// Full chunk content lives in chunkMap (in-memory); index stores only lightweight metadata.

const MINISEARCH_OPTIONS = {
  fields: ["sectionTitle", "headingPath", "content"],
  storeFields: [
    "href",
    "sourceTitle",
    "sectionTitle",
    "headingPath",
    "kind",
    "type",
    "language",
  ],
  searchOptions: {
    boost: { sectionTitle: 2.5, headingPath: 1.8, content: 1 },
    fuzzy: 0.1,
    prefix: true,
  },
};

function buildIndex(chunks) {
  const index = new MiniSearch(MINISEARCH_OPTIONS);
  index.addAll(chunks);
  return index;
}

// Corpus build and persistence

async function buildCorpus(productId) {
  const productDef = PRODUCT_TREE[productId];
  if (!productDef) return;
  if (buildInProgress.has(productId)) return;
  buildInProgress.add(productId);

  try {
    ensureDir(productCacheDir(productId));
    console.error(`[doc-search] building corpus for ${productId}...`);
    const t0 = Date.now();

    const chunks = await crawlProduct(productId, productDef);
    if (chunks.length === 0) {
      console.error(`[doc-search] no chunks produced for ${productId}`);
      return;
    }

    const index = buildIndex(chunks);
    const pageCount = new Set(chunks.map((c) => c.href.split("#")[0])).size;

    fs.writeFileSync(chunksFilePath(productId), JSON.stringify(chunks), "utf8");
    fs.writeFileSync(indexFilePath(productId), JSON.stringify(index), "utf8");
    fs.writeFileSync(
      manifestPath(productId),
      JSON.stringify({
        productId,
        builtAt: Date.now(),
        pageCount,
        chunkCount: chunks.length,
        version: DOC_SEARCH_CORPUS_VERSION,
      }),
      "utf8"
    );

    const chunkMap = new Map(chunks.map((c) => [c.id, c]));
    corpusState.set(productId, { index, chunkMap, builtAt: Date.now() });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(
      `[doc-search] ${productId}: ${chunks.length} chunks from ${pageCount} pages (${elapsed}s)`
    );
  } catch (err) {
    console.error(`[doc-search] corpus build failed for ${productId}: ${err?.message}`);
  } finally {
    buildInProgress.delete(productId);
  }
}

// Corpus load from disk

function isCorpusStale(productId) {
  const mp = manifestPath(productId);
  if (!fs.existsSync(mp)) return true;
  try {
    const manifest = JSON.parse(fs.readFileSync(mp, "utf8"));
    if (String(manifest?.version) !== DOC_SEARCH_CORPUS_VERSION) return true;
    return Date.now() - Number(manifest?.builtAt || 0) > DOC_SEARCH_CORPUS_TTL_MS;
  } catch {
    return true;
  }
}

function loadCorpusFromDisk(productId) {
  const cp = chunksFilePath(productId);
  const ip = indexFilePath(productId);
  if (!fs.existsSync(cp) || !fs.existsSync(ip)) return false;
  try {
    const chunks = JSON.parse(fs.readFileSync(cp, "utf8"));
    const index = MiniSearch.loadJSON(fs.readFileSync(ip, "utf8"), MINISEARCH_OPTIONS);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));
    corpusState.set(productId, { index, chunkMap, builtAt: Date.now() });
    return true;
  } catch (err) {
    console.error(`[doc-search] failed to load corpus for ${productId}: ${err?.message}`);
    return false;
  }
}

async function ensureCorpus(productId) {
  if (corpusState.has(productId)) return;
  if (!isCorpusStale(productId) && loadCorpusFromDisk(productId)) return;
  // Block on first use if nothing on disk; subsequent stale rebuilds are async.
  await buildCorpus(productId);
}

// Startup corpus init
//
// Called once at server startup. Loads fresh corpora from disk into memory
// synchronously (fast), then triggers async background rebuilds for stale ones.
// The server starts immediately -- corpus builds do not block app.listen.

export function initCorpus() {
  if (!DOC_SEARCH_ENABLED) return;
  for (const productId of Object.keys(PRODUCT_TREE)) {
    if (!isCorpusStale(productId)) {
      loadCorpusFromDisk(productId);
    } else {
      buildCorpus(productId).catch(() => {});
    }
  }
}

// Query helpers
//
// Incorporate the last few conversation turns so document retrieval
// reflects the evolving topic, not just the current one-liner.
// This is how hal+ behaves like a dedicated HashiCorp search without
// requiring the user to type explicit keywords on each turn.

function buildSearchQuery(messages, prompt) {
  const userTurns = (messages || [])
    .filter((m) => String(m?.role || "") === "user")
    .map((m) => String(m?.content || "").trim())
    .filter(Boolean)
    .slice(-4);
  const allText = [...new Set([...userTurns, String(prompt || "").trim()])];
  return allText.join(" ").slice(0, 800);
}

function contextProductId(context) {
  return String(
    context?.product?.product || context?.primary?.product || ""
  ).toLowerCase();
}

// Lexical retrieval

function searchCorpus(productId, query, topN) {
  const state = corpusState.get(productId);
  if (!state) return [];
  // MiniSearch may return more results than `limit` when fuzzy+prefix are both
  // enabled because scoring traversal doesn't always respect the cap cleanly.
  // Slice explicitly to guarantee we never send more than topN to the embedder.
  const results = state.index.search(query, { limit: topN });
  return results
    .slice(0, topN)
    .map((r) => {
      const full = state.chunkMap.get(r.id);
      return full ? { ...full, lexicalScore: r.score } : null;
    })
    .filter(Boolean);
}

// Embedding rerank

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length)
    return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedTexts(ollamaBaseUrl, model, input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error(`Ollama embed failed: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.embeddings) ? payload.embeddings : [];
}

async function rerankWithEmbeddings(query, chunks, ollamaBaseUrl) {
  if (chunks.length === 0) return chunks;
  const texts = chunks.map((c) =>
    `${c.headingPath || c.sectionTitle}\n${c.content}`.slice(0, 1200)
  );
  let embeddings;
  try {
    embeddings = await embedTexts(ollamaBaseUrl, DOC_SEARCH_EMBED_MODEL, [
      query,
      ...texts,
    ]);
  } catch {
    return chunks;
  }
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length + 1) return chunks;
  const queryVec = embeddings[0];
  return chunks
    .map((c, i) => {
      const sem = cosineSimilarity(queryVec, embeddings[i + 1]);
      return {
        ...c,
        semanticScore: sem,
        finalScore: Number(c.lexicalScore || 0) * 0.45 + sem * 0.55,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

// Payload helpers

function trimSnippet(content, size) {
  const limit = size || 280;
  const clean = String(content || "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 3)}...`;
}

// Nav-artifact fragments that add no value as doc anchors (Docusaurus skeleton labels).
const NAV_FRAGMENT_RE = /^#(sidebar-label|overview|introduction|table-of-contents|toc)$/i;

function cleanHref(href) {
  const h = String(href || "").trim();
  const hashIdx = h.indexOf("#");
  if (hashIdx === -1) return h;
  const fragment = h.slice(hashIdx);
  return NAV_FRAGMENT_RE.test(fragment) ? h.slice(0, hashIdx) : h;
}

function toDocsPayload(chunks) {
  const seen = new Set();
  const docs = [];
  for (const chunk of chunks) {
    const href = cleanHref(chunk.href);
    if (seen.has(href)) continue;
    seen.add(href);
    docs.push({
      title: chunk.sectionTitle || chunk.sourceTitle,
      href,
      kind: chunk.kind || "official",
      description: trimSnippet(chunk.content, 190),
    });
    if (docs.length >= 2) break;
  }
  return docs;
}

function toEvidencePayload(chunks, topK) {
  return chunks.slice(0, topK).map((c) => ({
    title: c.headingPath || c.sectionTitle || c.sourceTitle,
    href: c.href,
    kind: c.kind || "official",
    description: trimSnippet(c.content, 220),
    snippet: trimSnippet(c.content, 320),
    sourceTitle: c.sourceTitle,
    sectionTitle: c.sectionTitle,
    headingPath: c.headingPath,
    type: c.type || "text",
  }));
}

// Public exports

// Format top-K retrieved chunks as a grounding block for the LLM system prompt.
// Includes heading path so the model understands the section's position in the
// doc hierarchy and can cite precisely (e.g. href#jwt-role-configuration).
export function buildDocSearchPromptSupplement(searchResult) {
  const chunks = Array.isArray(searchResult?.chunks) ? searchResult.chunks : [];
  if (chunks.length === 0) return "";

  const lines = [
    "Retrieved documentation excerpts (static guidance, not runtime truth).",
    "Answer with HAL commands first. For each statement grounded here, cite the deepest section link available:",
  ];

  for (const chunk of chunks.slice(0, DOC_SEARCH_TOP_K)) {
    const location = chunk.headingPath || chunk.sectionTitle || chunk.sourceTitle;
    lines.push(`\n- Source: ${chunk.sourceTitle} | ${location}`);
    lines.push(`  Link: ${chunk.href}`);
    if (chunk.type === "code") {
      lines.push(`  Code (${chunk.language || "text"}):`);
      lines.push("  ```");
      lines.push(String(chunk.content || "").slice(0, 700));
      lines.push("  ```");
    } else {
      lines.push(`  Excerpt: ${trimSnippet(chunk.content, 420)}`);
    }
  }

  return lines.join("\n");
}

// Main retrieval entry point called from /api/chat and /api/docs.
//   options.messages        -- full conversation message array for richer query context
//   options.ollamaBaseUrl   -- Ollama base URL for embedding rerank
//   options.pinnedBaseUrls  -- base page URLs that must be represented in results
//                              (e.g. behavior resource pages). Injects best chunk from
//                              each pinned page if not already in top-K results.
export async function retrieveDocsForPrompt(prompt, context, options) {
  const opts = options || {};
  if (!DOC_SEARCH_ENABLED) {
    return { docs: [], chunks: [], mode: "disabled" };
  }

  const productId = contextProductId(context);
  if (!productId || !PRODUCT_TREE[productId]) {
    return { docs: [], chunks: [], mode: "no-product" };
  }

  if (!prompt) {
    return { docs: [], chunks: [], mode: "no-prompt" };
  }

  await ensureCorpus(productId);

  const state = corpusState.get(productId);
  if (!state) {
    return { docs: [], chunks: [], mode: "corpus-unavailable" };
  }

  const query = buildSearchQuery(opts.messages, prompt);

  const lexical = searchCorpus(productId, query, DOC_SEARCH_TOP_N);
  if (lexical.length === 0) {
    return { docs: [], chunks: [], mode: "no-match" };
  }

  const mode = DOC_SEARCH_MODE === "hybrid" ? "hybrid" : "lexical";
  const reranked =
    mode === "hybrid"
      ? await rerankWithEmbeddings(
          query,
          lexical,
          opts.ollamaBaseUrl || "http://127.0.0.1:11434"
        )
      : lexical;

  const topChunks = reranked.slice(0, DOC_SEARCH_TOP_K);

  // Inject best-scoring chunk from each pinned base URL not already in topChunks.
  // Checks reranked candidates first; falls back to a full corpus scan.
  const pinnedBaseUrls = Array.isArray(opts.pinnedBaseUrls) ? opts.pinnedBaseUrls : [];
  if (pinnedBaseUrls.length > 0 && state.chunkMap) {
    const representedBases = new Set(
      topChunks.map((c) => String(c.href || "").split("#")[0])
    );
    for (const baseUrl of pinnedBaseUrls) {
      if (representedBases.has(baseUrl)) continue;
      // Best chunk already scored by rerank but outside top-K
      const fromReranked = reranked.find(
        (c) => String(c.href || "").split("#")[0] === baseUrl
      );
      if (fromReranked) {
        topChunks.push(fromReranked);
        representedBases.add(baseUrl);
        continue;
      }
      // Not in BM25 top-N at all — fall back to first corpus chunk for that page
      for (const chunk of state.chunkMap.values()) {
        if (String(chunk.href || "").split("#")[0] === baseUrl) {
          topChunks.push(chunk);
          representedBases.add(baseUrl);
          break;
        }
      }
    }
  }

  // Float pinned-base chunks to the front in pinnedBaseUrls order (behavior resource priority),
  // not BM25 score order. This ensures the first/most-specific resource page always leads.
  const pinnedSet = new Set(pinnedBaseUrls);
  const sortedForDocs = pinnedSet.size > 0
    ? [
        ...pinnedBaseUrls.flatMap((base) =>
          topChunks.filter((c) => String(c.href || "").split("#")[0] === base)
        ),
        ...topChunks.filter((c) => !pinnedSet.has(String(c.href || "").split("#")[0])),
      ]
    : topChunks;

  const docs = toDocsPayload(sortedForDocs);
  // Evidence uses sortedForDocs so pinned chunks (floated to front) are visible to buildKnowledgeAnswer.
  const evidence = toEvidencePayload(sortedForDocs, DOC_SEARCH_TOP_K);

  return {
    docs,
    evidence,
    chunks: topChunks,
    mode,
    debug: {
      product: productId,
      corpusChunks: state.chunkMap.size,
      considered: lexical.length,
      queryPreview: query.slice(0, 120),
    },
  };
}
