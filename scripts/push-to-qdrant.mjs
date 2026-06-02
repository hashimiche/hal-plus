// push-to-qdrant.mjs
//
// Ingest the on-disk HAL Plus doc-search corpus into Qdrant. This is the Qdrant
// counterpart of the MiniSearch corpus that doc-search.mjs builds on disk:
//
//   doc-search.mjs   -> .hal-plus-cache/doc-search/<product>/chunks.json  (local backend)
//   push-to-qdrant   -> upserts the same chunks (+ embeddings) into Qdrant (qdrant backend)
//
// Embeddings are computed here via Ollama (same model + dimension as the local
// rerank path) so the two backends stay vector-compatible.
//
// Prerequisites:
//   - A populated local corpus (start the server once, or it builds on demand).
//   - A running Qdrant (npm run qdrant:up) and Ollama with nomic-embed-text.
//
// Usage:
//   npm run push-to-qdrant
//   npm run push-to-qdrant -- --recreate          # drop + recreate collection
//   npm run push-to-qdrant -- --product vault      # limit to one product
//
// Env:
//   HAL_QDRANT_URL, HAL_QDRANT_COLLECTION          (see server/qdrant-client.mjs)
//   HAL_DOC_SEARCH_CACHE_DIR                        (default .hal-plus-cache/doc-search)
//   HAL_DOC_SEARCH_EMBED_MODEL                      (default nomic-embed-text)
//   OLLAMA_BASE_URL                                 (default http://127.0.0.1:11434)
//   HAL_EMBED_CACHE                                 (optional NDJSON vector cache path;
//                                                    when set, unchanged chunks are not
//                                                    re-embedded — used by CI to cut runtime)

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  chunkIdToUuid,
  deriveSourceType,
  ensureCollection,
  upsertPoints,
  scrollPayloadValues,
  qdrantUrl,
  qdrantCollection,
  ping,
} from "../server/qdrant-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const RECREATE = process.argv.includes("--recreate");
const productArgIdx = process.argv.indexOf("--product");
const PRODUCT_FILTER = productArgIdx !== -1 ? process.argv[productArgIdx + 1] : null;

const CACHE_DIR = path.resolve(
  ROOT,
  process.env.HAL_DOC_SEARCH_CACHE_DIR || ".hal-plus-cache/doc-search"
);
const EMBED_MODEL = process.env.HAL_DOC_SEARCH_EMBED_MODEL || "nomic-embed-text";
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
  /\/+$/,
  ""
);
const EMBED_BATCH = 32;
const UPSERT_BATCH = 100;

// Optional embedding cache (NDJSON: {"k":<md5>,"v":[...]} per line).
// Keyed by the embedding model + chunk text, so cached vectors survive across
// runs as long as the model and the chunk text are unchanged. The cache is a
// pure optimization: a miss simply re-embeds. Enabled only when HAL_EMBED_CACHE
// is set (CI restores/saves it via actions/cache); local runs are unaffected.
const EMBED_CACHE_PATH = process.env.HAL_EMBED_CACHE
  ? path.resolve(ROOT, process.env.HAL_EMBED_CACHE)
  : null;

const embedCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

function embedCacheKey(text) {
  return crypto.createHash("md5").update(`${EMBED_MODEL}\u0000${text}`).digest("hex");
}

function loadEmbedCache() {
  if (!EMBED_CACHE_PATH || !fs.existsSync(EMBED_CACHE_PATH)) return;
  let n = 0;
  try {
    for (const line of fs.readFileSync(EMBED_CACHE_PATH, "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const { k, v } = JSON.parse(s);
        if (k && Array.isArray(v)) {
          embedCache.set(k, v);
          n++;
        }
      } catch {
        /* skip corrupt line */
      }
    }
  } catch (err) {
    console.warn(`  ! failed to read embed cache: ${err.message}`);
    return;
  }
  console.log(`  embed cache: ${n} vector(s) loaded from ${EMBED_CACHE_PATH}`);
}

function appendEmbedCache(entries) {
  if (!EMBED_CACHE_PATH || entries.length === 0) return;
  fs.mkdirSync(path.dirname(EMBED_CACHE_PATH), { recursive: true });
  fs.appendFileSync(EMBED_CACHE_PATH, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}


function listProducts() {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((p) => !PRODUCT_FILTER || p === PRODUCT_FILTER);
}

function loadChunks(product) {
  const file = path.join(CACHE_DIR, product, "chunks.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`  ! failed to parse ${file}: ${err.message}`);
    return [];
  }
}

async function embedBatch(texts) {
  const resp = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama embed failed: ${resp.status} ${await resp.text().catch(() => "")}`);
  }
  const payload = await resp.json();
  return Array.isArray(payload?.embeddings) ? payload.embeddings : [];
}

// Embed a batch, serving unchanged texts from the cache and only calling Ollama
// for cache misses. Newly embedded vectors are appended to the cache file.
async function embedBatchCached(texts) {
  const out = new Array(texts.length);
  const missIdx = [];
  const missTexts = [];
  const missKeys = [];
  for (let i = 0; i < texts.length; i++) {
    const key = embedCacheKey(texts[i]);
    const hit = embedCache.get(key);
    if (hit) {
      out[i] = hit;
      cacheHits++;
    } else {
      missIdx.push(i);
      missTexts.push(texts[i]);
      missKeys.push(key);
    }
  }
  if (missTexts.length > 0) {
    const fresh = await embedBatch(missTexts);
    if (fresh.length !== missTexts.length) {
      throw new Error(`embed count mismatch: got ${fresh.length}, expected ${missTexts.length}`);
    }
    const newEntries = [];
    for (let j = 0; j < missIdx.length; j++) {
      out[missIdx[j]] = fresh[j];
      embedCache.set(missKeys[j], fresh[j]);
      newEntries.push({ k: missKeys[j], v: fresh[j] });
      cacheMisses++;
    }
    appendEmbedCache(newEntries);
  }
  return out;
}

function sourcePage(chunk) {
  return String(chunk.href || "").split("#")[0];
}

function chunkText(chunk) {
  return `${chunk.headingPath || chunk.sectionTitle || chunk.sourceTitle || ""}\n${
    chunk.content || ""
  }`.slice(0, 1200);
}

async function main() {
  console.log("\nHAL Plus -> push corpus to Qdrant");
  console.log(`  Qdrant:     ${qdrantUrl()}`);
  console.log(`  Collection: ${qdrantCollection()}`);
  console.log(`  Embedder:   ${EMBED_MODEL} @ ${OLLAMA_BASE_URL}`);
  console.log(`  Mode:       ${RECREATE ? "recreate" : "incremental"}`);
  console.log(`  Cache dir:  ${CACHE_DIR}`);
  console.log(`  Embed cache: ${EMBED_CACHE_PATH || "(disabled)"}\n`);

  loadEmbedCache();

  if (!(await ping())) {
    console.error(`Qdrant not reachable at ${qdrantUrl()}. Start it with: npm run qdrant:up`);
    process.exit(1);
  }

  const products = listProducts();
  if (products.length === 0) {
    console.error(
      `No corpus found under ${CACHE_DIR}. Run the server once to build it, then retry.`
    );
    process.exit(1);
  }

  const created = await ensureCollection({ recreate: RECREATE });
  console.log(created ? "Collection created." : "Collection already exists.");

  // Incremental: skip pages already present in the collection.
  let indexedPages = new Set();
  if (!RECREATE) {
    indexedPages = await scrollPayloadValues("source_page");
    if (indexedPages.size > 0) {
      console.log(`  ${indexedPages.size} source pages already indexed (incremental).`);
    }
  }

  let totalUpserted = 0;

  for (const product of products) {
    const allChunks = loadChunks(product);
    const chunks = RECREATE
      ? allChunks
      : allChunks.filter((c) => !indexedPages.has(sourcePage(c)));

    if (chunks.length === 0) {
      console.log(`  ${product}: nothing new (${allChunks.length} chunks already indexed).`);
      continue;
    }
    console.log(`  ${product}: embedding ${chunks.length} / ${allChunks.length} chunks...`);

    const points = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatchCached(slice.map(chunkText));
      if (vectors.length !== slice.length) {
        throw new Error(
          `embed count mismatch for ${product}: got ${vectors.length}, expected ${slice.length}`
        );
      }
      slice.forEach((chunk, j) => {
        points.push({
          id: chunkIdToUuid(chunk.id),
          vector: vectors[j],
          payload: {
            id: chunk.id,
            product: chunk.product || product,
            source_type: deriveSourceType(chunk.href),
            source_page: sourcePage(chunk),
            content: chunk.content || "",
            type: chunk.type || "text",
            language: chunk.language || null,
            kind: chunk.kind || "official",
            href: chunk.href || null,
            sourceTitle: chunk.sourceTitle || null,
            sectionTitle: chunk.sectionTitle || null,
            headingPath: chunk.headingPath || null,
          },
        });
      });
      process.stdout.write(`\r    embedded ${Math.min(i + EMBED_BATCH, chunks.length)} / ${chunks.length}`);
    }
    process.stdout.write("\n");

    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      await upsertPoints(points.slice(i, i + UPSERT_BATCH));
      totalUpserted += Math.min(UPSERT_BATCH, points.length - i);
      process.stdout.write(`\r    upserted ${Math.min(i + UPSERT_BATCH, points.length)} / ${points.length}`);
    }
    process.stdout.write("\n");
  }

  if (EMBED_CACHE_PATH) {
    console.log(`\nEmbed cache: ${cacheHits} hit(s), ${cacheMisses} miss(es).`);
  }
  console.log(`\nDone. ${totalUpserted} points upserted into "${qdrantCollection()}".`);
  if (totalUpserted > 0) {
    console.log("Set HAL_RAG_BACKEND=qdrant and restart the server to query Qdrant.\n");
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
