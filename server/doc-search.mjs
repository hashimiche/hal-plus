import fs from "fs";
import path from "path";
import crypto from "crypto";
import { collectBehaviorResources } from "./behavior-registry.mjs";

const DOC_SEARCH_ENABLED = String(process.env.HAL_DOC_SEARCH_ENABLED || "true").toLowerCase() !== "false";
const DOC_SEARCH_MODE = String(process.env.HAL_DOC_SEARCH_MODE || "hybrid").toLowerCase();
const DOC_SEARCH_TOP_N = Number(process.env.HAL_DOC_SEARCH_TOP_N || 20);
const DOC_SEARCH_TOP_K = Number(process.env.HAL_DOC_SEARCH_TOP_K || 6);
const DOC_SEARCH_MAX_DOCS = Number(process.env.HAL_DOC_SEARCH_MAX_DOCS || 4);
const DOC_SEARCH_MIN_DOC_SCORE = Number(process.env.HAL_DOC_SEARCH_MIN_DOC_SCORE || 2);
const DOC_SEARCH_EMBED_MODEL = process.env.HAL_DOC_SEARCH_EMBED_MODEL || "nomic-embed-text";
const DOC_SEARCH_CACHE_TTL_MS = Number(process.env.HAL_DOC_SEARCH_CACHE_TTL_MS || 12 * 60 * 60 * 1000);
const DOC_SEARCH_CACHE_DIR = path.resolve(process.cwd(), process.env.HAL_DOC_SEARCH_CACHE_DIR || ".hal-plus-cache/doc-search");
const DOC_SEARCH_DISCOVER_SUBPAGES = String(process.env.HAL_DOC_SEARCH_DISCOVER_SUBPAGES || "true").toLowerCase() !== "false";
const DOC_SEARCH_DISCOVER_MAX = Number(process.env.HAL_DOC_SEARCH_DISCOVER_MAX || 30);

const DOC_ALLOWED_HOSTS = new Set(["developer.hashicorp.com", "www.hashicorp.com", "hashicorp.com"]);

const PRODUCT_DOC_RULES = {
  terraform: {
    label: "Terraform",
    discoverRoots: ["/terraform/enterprise"],
    pathPrefixes: ["/terraform", "/validated-patterns/terraform"],
    intentTerms: ["workspace", "vcs", "agent", "oauth", "gitlab", "github", "run"]
  },
  vault: {
    label: "Vault",
    discoverRoots: ["/vault"],
    pathPrefixes: ["/vault", "/validated-patterns/vault"],
    intentTerms: ["auth", "token", "policy", "kv", "jwt", "oidc", "kubernetes", "ldap", "audit"]
  }
};

const chunkCache = new Map();

function uniqueByHref(items) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const href = String(item?.href || "").trim();
    if (!href || seen.has(href)) {
      continue;
    }
    seen.add(href);
    output.push(item);
  }
  return output;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isProductOfficialResource(resource, context) {
  const href = String(resource?.href || "").trim();
  if (!href) {
    return false;
  }

  const productId = String(context?.product?.product || context?.primary?.product || "").toLowerCase();
  const productRule = PRODUCT_DOC_RULES[productId];
  if (!productRule) {
    return false;
  }

  const url = safeParseUrl(href);
  if (!url || !(url.protocol === "https:" || url.protocol === "http:")) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  if (!DOC_ALLOWED_HOSTS.has(host)) {
    return false;
  }

  if (host !== "developer.hashicorp.com") {
    return true;
  }

  const normalizedPath = String(url.pathname || "").replace(/\/+$/, "");
  return productRule.pathPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

function hashForUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function cacheFilePath(url) {
  return path.join(DOC_SEARCH_CACHE_DIR, "web", `${hashForUrl(url)}.json`);
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

function contentTitle(raw) {
  const match = String(raw || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "Untitled";
  }
  return stripHtml(match[1]).slice(0, 160) || "Untitled";
}

function tokenize(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function promptHasAny(prompt, terms) {
  const lower = String(prompt || "").toLowerCase();
  return (terms || []).some((term) => lower.includes(String(term || "").toLowerCase()));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "what",
  "when",
  "where",
  "how",
  "why",
  "should",
  "would",
  "could",
  "give",
  "show",
  "setup",
  "set",
  "use",
  "using",
  "help",
  "please",
  "about",
  "your",
  "have",
  "there",
  "they",
  "them",
  "then",
  "than",
  "also",
  "just",
  "some",
  "kind",
  "question"
]);

function extractPromptTerms(prompt) {
  const tokens = tokenize(prompt).filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return [...new Set(tokens)];
}

function selectProductResources(context, prompt) {
  const selected = Array.isArray(context?.selected) ? context.selected : [];
  const primary = context?.primary || null;
  const product = context?.product || null;

  let resources = [];
  if (primary && primary.subcommand && primary.subcommand !== "product") {
    resources = []
      .concat(Array.isArray(primary.resources) ? primary.resources : [])
      .concat(Array.isArray(product?.resources) ? product.resources : []);
  } else if (selected.length > 0) {
    resources = selected.flatMap((behavior) => (Array.isArray(behavior?.resources) ? behavior.resources : []));
  } else {
    resources = collectBehaviorResources(context);
  }

  return uniqueByHref(resources).filter((resource) => isProductOfficialResource(resource, context));
}

function extractHrefListFromHtml(html) {
  const hrefs = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const href = String(match[1] || "").trim();
    if (href) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

function getDiscoverableRootRule(resource, context) {
  const url = safeParseUrl(resource?.href || "");
  if (!url) {
    return null;
  }

  const productId = String(context?.product?.product || context?.primary?.product || "").toLowerCase();
  const productRule = PRODUCT_DOC_RULES[productId];
  if (!productRule) {
    return null;
  }

  const host = String(url.hostname || "").toLowerCase();
  const normalizedPath = String(url.pathname || "").replace(/\/+$/, "");
  if (host !== "developer.hashicorp.com") {
    return null;
  }

  const matchedRoot = productRule.discoverRoots.find((root) => normalizedPath === root);
  if (!matchedRoot) {
    return null;
  }

  return {
    productId,
    label: productRule.label,
    rootPath: matchedRoot,
    intentTerms: productRule.intentTerms || []
  };
}

function subpageResourceFromUrl(url, parentResource, discoverRule) {
  const slug = String(url.pathname || "").split("/").filter(Boolean).pop() || "page";
  const titleFromSlug = slug
    .split("-")
    .filter(Boolean)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");

  const label = discoverRule?.label || "Product";
  const parentTitle = parentResource?.title || `${label} Docs`;

  return {
    title: `${label} ${titleFromSlug}`,
    href: url.toString(),
    kind: parentResource?.kind || "official",
    description: `Discovered child page from ${parentTitle}.`
  };
}

async function discoverProductSubpages(resource, prompt, context) {
  const discoverRule = getDiscoverableRootRule(resource, context);
  if (!DOC_SEARCH_DISCOVER_SUBPAGES || !discoverRule) {
    return [];
  }

  const facetTerms = extractPromptTerms(prompt);

  let fetched;
  try {
    fetched = await readOrFetchUrl(resource.href);
  } catch {
    return [];
  }

  const rootUrl = safeParseUrl(resource.href);
  if (!rootUrl) {
    return [];
  }

  const rawLinks = extractHrefListFromHtml(String(fetched?.body || ""));
  const discovered = [];

  for (const rawHref of rawLinks) {
    let parsed;
    try {
      parsed = new URL(rawHref, rootUrl);
    } catch {
      continue;
    }

    const host = String(parsed.hostname || "").toLowerCase();
    if (host !== "developer.hashicorp.com") {
      continue;
    }

    const pathname = String(parsed.pathname || "").replace(/\/+$/, "");
    if (!pathname.startsWith(`${discoverRule.rootPath}/`)) {
      continue;
    }

    if (pathname === discoverRule.rootPath) {
      continue;
    }

    if (/\.(png|jpg|jpeg|gif|svg|webp|pdf|zip)$/i.test(pathname)) {
      continue;
    }

    const href = `${parsed.origin}${pathname}`;
    const candidateText = `${pathname} ${href}`.toLowerCase();
    const termHits = facetTerms.reduce((hits, term) => (candidateText.includes(term) ? hits + 1 : hits), 0);
    const intentBoost = promptHasAny(prompt, discoverRule.intentTerms) ? 1 : 0;
    const score = termHits + intentBoost;

    discovered.push({ href, score, parsed });
  }

  const unique = [];
  const seen = new Set();
  for (const entry of discovered.sort((a, b) => b.score - a.score)) {
    if (seen.has(entry.href)) {
      continue;
    }
    seen.add(entry.href);
    unique.push(subpageResourceFromUrl(entry.parsed, resource, discoverRule));
    if (unique.length >= DOC_SEARCH_DISCOVER_MAX) {
      break;
    }
  }

  return unique.slice(0, DOC_SEARCH_DISCOVER_MAX);
}

async function expandResourcesWithDiscoveredSubpages(resources, prompt, context) {
  const base = uniqueByHref(resources || []);
  const expanded = [...base];

  for (const resource of base) {
    const discovered = await discoverProductSubpages(resource, prompt, context);
    expanded.push(...discovered);
  }

  return uniqueByHref(expanded);
}

function toTermFrequency(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = Number(vecA[i] || 0);
    const b = Number(vecB[i] || 0);
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function readOrFetchUrl(url) {
  ensureDir(path.join(DOC_SEARCH_CACHE_DIR, "web"));
  const filePath = cacheFilePath(url);

  if (fs.existsSync(filePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Date.now() - Number(cached?.fetchedAt || 0) < DOC_SEARCH_CACHE_TTL_MS) {
        return cached;
      }
    } catch {
      // Fall through to refetch if cache is corrupt.
    }
  }

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Doc fetch failed for ${url}: ${response.status}`);
  }

  const body = await response.text();
  const contentType = response.headers.get("content-type") || "text/html";
  const payload = {
    url,
    contentType,
    body,
    fetchedAt: Date.now()
  };

  fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return payload;
}

function splitPlainTextIntoChunks(text, maxLen = 1100) {
  const paragraphs = String(text || "")
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLen) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }

    if (paragraph.length <= maxLen) {
      buffer = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += maxLen) {
      chunks.push(paragraph.slice(i, i + maxLen));
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

function extractCodeBlocksFromHtml(html) {
  const blocks = [];
  const regex = /<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;
  let match;

  while ((match = regex.exec(String(html || ""))) !== null) {
    const attrs = String(match[1] || "");
    const raw = decodeEntities(match[2] || "")
      .replace(/\r/g, "")
      .trim();
    if (!raw) {
      continue;
    }

    const langMatch = attrs.match(/language-([a-z0-9_\-]+)/i) || attrs.match(/lang(?:uage)?=["']?([a-z0-9_\-]+)/i);
    blocks.push({
      language: langMatch ? String(langMatch[1]).toLowerCase() : "text",
      content: raw
    });
  }

  return blocks;
}

function normalizeFetchedDoc(resource, fetched) {
  const contentType = String(fetched?.contentType || "").toLowerCase();
  const body = String(fetched?.body || "");
  const title = contentType.includes("html") ? contentTitle(body) : resource?.title || "Untitled";
  const plainText = contentType.includes("html") ? stripHtml(body) : String(body || "");
  const baseChunks = splitPlainTextIntoChunks(plainText).map((content, index) => ({
    id: `${resource.href}#text-${index + 1}`,
    type: "text",
    content,
    title,
    sourceTitle: resource.title || title,
    href: resource.href,
    kind: resource.kind || "guide",
    language: "text"
  }));

  const codeBlocks = extractCodeBlocksFromHtml(body).map((code, index) => ({
    id: `${resource.href}#code-${index + 1}`,
    type: "code",
    content: code.content,
    title,
    sourceTitle: resource.title || title,
    href: resource.href,
    kind: resource.kind || "guide",
    language: code.language || "text"
  }));

  return [...baseChunks, ...codeBlocks];
}

async function getResourceChunks(resource) {
  if (chunkCache.has(resource.href)) {
    return chunkCache.get(resource.href);
  }

  try {
    const fetched = await readOrFetchUrl(resource.href);
    const chunks = normalizeFetchedDoc(resource, fetched).slice(0, 80);
    chunkCache.set(resource.href, chunks);
    return chunks;
  } catch {
    chunkCache.set(resource.href, []);
    return [];
  }
}

function lexicalRank(prompt, chunks, topN) {
  const queryTokens = tokenize(prompt);
  if (queryTokens.length === 0) {
    return [];
  }

  const querySet = new Set(queryTokens);
  const scored = chunks
    .map((chunk) => {
      const text = `${chunk.title}\n${chunk.content}`;
      const tokens = tokenize(text);
      const tf = toTermFrequency(tokens);
      let score = 0;
      for (const token of querySet) {
        const freq = tf.get(token) || 0;
        if (freq > 0) {
          score += 1 + Math.log1p(freq);
        }
      }

      if (chunk.type === "code") {
        score += 0.35;
      }

      const lowerContent = text.toLowerCase();
      if (lowerContent.includes(String(prompt || "").toLowerCase())) {
        score += 0.8;
      }

      return { ...chunk, lexicalScore: score };
    })
    .filter((chunk) => chunk.lexicalScore > 0)
    .sort((left, right) => right.lexicalScore - left.lexicalScore);

  return scored.slice(0, topN);
}

async function embedTexts(ollamaBaseUrl, model, input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }

  const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input })
  });

  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.embeddings) ? payload.embeddings : [];
}

async function rerankWithEmbeddings(prompt, ranked, ollamaBaseUrl) {
  const payloads = ranked.map((entry) => `${entry.title}\n${entry.content}`.slice(0, 1200));
  const inputs = [prompt, ...payloads];

  let embeddings = [];
  try {
    embeddings = await embedTexts(ollamaBaseUrl, DOC_SEARCH_EMBED_MODEL, inputs);
  } catch {
    return ranked;
  }

  if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) {
    return ranked;
  }

  const queryVector = embeddings[0];
  const reranked = ranked
    .map((entry, index) => {
      const semanticScore = cosineSimilarity(queryVector, embeddings[index + 1]);
      const lexicalScore = Number(entry.lexicalScore || 0);
      return {
        ...entry,
        semanticScore,
        finalScore: lexicalScore * 0.45 + semanticScore * 0.55
      };
    })
    .sort((left, right) => Number(right.finalScore || 0) - Number(left.finalScore || 0));

  return reranked;
}

function trimSnippet(content, size = 280) {
  const clean = String(content || "").replace(/\s+/g, " ").trim();
  if (clean.length <= size) {
    return clean;
  }
  return `${clean.slice(0, size - 3)}...`;
}

function toDocsPayload(chunks) {
  const seen = new Set();
  const docs = [];

  const ordered = [...(chunks || [])].sort((left, right) => {
    const leftScore = Number(left.finalScore || left.lexicalScore || 0);
    const rightScore = Number(right.finalScore || right.lexicalScore || 0);
    const leftOfficial = left.kind === "official" ? 1 : 0;
    const rightOfficial = right.kind === "official" ? 1 : 0;

    if (rightOfficial !== leftOfficial) {
      return rightOfficial - leftOfficial;
    }

    return rightScore - leftScore;
  });

  for (const chunk of ordered) {
    const key = chunk.href;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    docs.push({
      title: chunk.sourceTitle || chunk.title,
      href: chunk.href,
      kind: chunk.kind || "guide",
      description: trimSnippet(chunk.content, 190)
    });

    if (docs.length >= 4) {
      break;
    }
  }

  return docs;
}

function resourceScoreForPrompt(prompt, resource, promptTerms) {
  const title = String(resource?.title || "").toLowerCase();
  const href = String(resource?.href || "").toLowerCase();
  const description = String(resource?.description || "").toLowerCase();
  const joined = `${title} ${href} ${description}`;
  let score = 0;

  if (resource?.kind === "official") {
    score += 0.5;
  }

  for (const term of promptTerms || []) {
    if (joined.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function backfillDocs(docs, resources, prompt, maxResults = 4) {
  const promptTerms = extractPromptTerms(prompt);
  const existing = new Set((docs || []).map((item) => item.href));
  const output = [...(docs || [])];
  const rankedResources = uniqueByHref(resources || [])
    .map((resource) => ({ resource, score: resourceScoreForPrompt(prompt, resource, promptTerms) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.resource);

  for (const resource of rankedResources) {
    if (output.length >= maxResults) {
      break;
    }
    if (existing.has(resource.href)) {
      continue;
    }

    existing.add(resource.href);
    output.push({
      title: resource.title,
      href: resource.href,
      kind: resource.kind || "guide",
      description: resource.description || "Related official guidance."
    });
  }

  return output.slice(0, maxResults);
}

function filterDocsByPromptRelevance(prompt, docs, maxResults = DOC_SEARCH_MAX_DOCS) {
  const promptTerms = extractPromptTerms(prompt);
  if (promptTerms.length === 0) {
    return [];
  }

  const scored = (docs || [])
    .map((doc) => {
      const score = resourceScoreForPrompt(prompt, doc, promptTerms);
      return { doc, score };
    })
    .sort((left, right) => right.score - left.score);

  const bestScore = Number(scored[0]?.score || 0);
  if (bestScore < DOC_SEARCH_MIN_DOC_SCORE) {
    return [];
  }

  const floor = Math.max(DOC_SEARCH_MIN_DOC_SCORE, bestScore * 0.5);
  return scored
    .filter((entry) => entry.score >= floor)
    .slice(0, maxResults)
    .map((entry) => entry.doc);
}

export function buildDocSearchPromptSupplement(searchResult) {
  const chunks = Array.isArray(searchResult?.chunks) ? searchResult.chunks : [];
  if (chunks.length === 0) {
    return "";
  }

  const lines = [
    "Retrieved documentation excerpts (static guidance, not runtime truth):"
  ];

  for (const chunk of chunks.slice(0, DOC_SEARCH_TOP_K)) {
    lines.push(`- Source: ${chunk.sourceTitle || chunk.title} (${chunk.href})`);
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

export async function retrieveDocsForPrompt(prompt, context, options = {}) {
  if (!DOC_SEARCH_ENABLED) {
    return { docs: [], chunks: [], mode: "disabled" };
  }

  const selectedResources = selectProductResources(context, prompt);
  const resources = await expandResourcesWithDiscoveredSubpages(selectedResources, prompt, context);
  if (!prompt || resources.length === 0) {
    return { docs: [], chunks: [], mode: DOC_SEARCH_MODE };
  }

  const allChunks = [];
  for (const resource of resources) {
    const resourceChunks = await getResourceChunks(resource);
    allChunks.push(...resourceChunks);
  }

  if (allChunks.length === 0) {
    return { docs: [], chunks: [], mode: DOC_SEARCH_MODE };
  }

  const lexical = lexicalRank(prompt, allChunks, DOC_SEARCH_TOP_N);
  if (lexical.length === 0) {
    return { docs: [], chunks: [], mode: DOC_SEARCH_MODE };
  }

  const mode = DOC_SEARCH_MODE === "hybrid" ? "hybrid" : "lexical";
  const reranked =
    mode === "hybrid" ? await rerankWithEmbeddings(prompt, lexical, options.ollamaBaseUrl || "http://127.0.0.1:11434") : lexical;
  const topChunks = reranked.slice(0, DOC_SEARCH_TOP_K);
  const docCandidates = backfillDocs(toDocsPayload(topChunks), resources, prompt, 16);
  const docs = filterDocsByPromptRelevance(prompt, docCandidates, DOC_SEARCH_MAX_DOCS);

  return {
    docs,
    chunks: topChunks,
    mode,
    debug: {
      resources: resources.length,
      chunks: allChunks.length,
      considered: lexical.length
    }
  };
}