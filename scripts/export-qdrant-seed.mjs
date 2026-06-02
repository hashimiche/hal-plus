// export-qdrant-seed.mjs
//
// Dump every point (id + vector + payload) from a running Qdrant collection to
// a newline-delimited JSON file, so it can be replayed into a fresh Qdrant
// instance when baking the pre-seeded corpus image (build-qdrant-image.mjs).
//
// This is intentionally decoupled from embedding: the vectors are already
// computed in the source collection, so the export/replay round-trip needs no
// Ollama and is fully deterministic.
//
// Usage:
//   node scripts/export-qdrant-seed.mjs [outFile]
//
// Env:
//   HAL_QDRANT_URL        source Qdrant (default http://127.0.0.1:6333)
//   HAL_QDRANT_COLLECTION source collection (default hal-plus)

import fs from "node:fs";
import path from "node:path";
import { qdrantUrl, qdrantCollection } from "../server/qdrant-client.mjs";

const outFile = process.argv[2] || ".qdrant-build/seed.jsonl";

async function main() {
  const url = qdrantUrl();
  const collection = qdrantCollection();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const out = fs.createWriteStream(outFile);

  let offset = null;
  let total = 0;
  for (;;) {
    const body = { limit: 512, with_payload: true, with_vector: true };
    if (offset !== null) body.offset = offset;
    const resp = await fetch(`${url}/collections/${collection}/points/scroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`scroll -> ${resp.status}: ${await resp.text().catch(() => "")}`);
    }
    const data = await resp.json();
    const points = data?.result?.points || [];
    for (const p of points) {
      out.write(JSON.stringify({ id: p.id, vector: p.vector, payload: p.payload }) + "\n");
      total++;
    }
    offset = data?.result?.next_page_offset;
    if (!offset) break;
  }

  await new Promise((res) => out.end(res));
  const sizeMb = (fs.statSync(outFile).size / 1048576).toFixed(1);
  console.log(`✅ exported ${total} points from ${collection} -> ${outFile} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error(`❌ export failed: ${err.message}`);
  process.exit(1);
});
