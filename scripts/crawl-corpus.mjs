// crawl-corpus.mjs
//
// Headless corpus crawl for the corpus-image pipeline. Crawls every product in
// PRODUCT_TREE and writes chunks.json/index/manifest to the on-disk cache
// (.hal-plus-cache/doc-search/<product>/). This is the standalone counterpart of
// the async crawl that the server triggers at startup, suitable for CI where no
// HTTP server is running.
//
// Downstream, push-to-qdrant.mjs reads those chunks, embeds them via Ollama, and
// upserts them into Qdrant.
//
// Usage:
//   node scripts/crawl-corpus.mjs
//
// Env (see server/doc-search.mjs):
//   HAL_DOC_SEARCH_CACHE_DIR, HAL_DOC_SEARCH_CRAWL_DEPTH, HAL_DOC_SEARCH_ENABLED

import { buildAllCorpora } from "../server/doc-search.mjs";

async function main() {
  const t0 = Date.now();
  console.log("🕸️  Crawling HAL Plus doc corpus (all products) ...");
  const products = await buildAllCorpora();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✅ Crawled ${products.length} product(s) in ${elapsed}s: ${products.join(", ")}`);
}

main().catch((err) => {
  console.error(`❌ corpus crawl failed: ${err?.message || err}`);
  process.exit(1);
});
