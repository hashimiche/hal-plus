// crawl-corpus.mjs
//
// Headless corpus crawl for the corpus-image pipeline. Crawls products in
// PRODUCT_TREE and writes chunks.json/index/manifest to the on-disk cache
// (.hal-plus-cache/doc-search/<product>/). This is the standalone counterpart of
// the async crawl that the server triggers at startup, suitable for CI where no
// HTTP server is running.
//
// Downstream, push-to-qdrant.mjs reads those chunks, embeds them via Ollama, and
// upserts them into Qdrant.
//
// Usage:
//   node scripts/crawl-corpus.mjs                 # crawl every product
//   node scripts/crawl-corpus.mjs --product vault  # crawl one product (CI matrix)
//   node scripts/crawl-corpus.mjs --list           # print product ids (one per line)
//
// Env (see server/doc-search.mjs):
//   HAL_DOC_SEARCH_CACHE_DIR, HAL_DOC_SEARCH_CRAWL_DEPTH, HAL_DOC_SEARCH_ENABLED

import { buildCorpora, listCorpusProducts } from "../server/doc-search.mjs";

async function main() {
  if (process.argv.includes("--list")) {
    console.log(listCorpusProducts().join("\n"));
    return;
  }

  const productArgIdx = process.argv.indexOf("--product");
  const product = productArgIdx !== -1 ? process.argv[productArgIdx + 1] : null;
  const productIds = product ? [product] : undefined;

  const t0 = Date.now();
  console.log(
    `🕸️  Crawling HAL Plus doc corpus (${product || "all products"}) ...`
  );
  const crawled = await buildCorpora(productIds);
  if (crawled.length === 0) {
    throw new Error(
      `no products crawled${product ? ` — unknown product "${product}"` : ""}`
    );
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✅ Crawled ${crawled.length} product(s) in ${elapsed}s: ${crawled.join(", ")}`);
}

main().catch((err) => {
  console.error(`❌ corpus crawl failed: ${err?.message || err}`);
  process.exit(1);
});
