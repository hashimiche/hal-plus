// eval/score.mjs
//
// STEP 2 of the retrieval eval harness: score retrieval quality.
//
// For each question in eval/testset.json:
//   embed -> Qdrant vector search (top-10, product-filtered) -> check whether
//   the gold section (canonical, version-agnostic) appears and how high it ranks.
//
// Reports:
//   Recall@1/5/10 - can retrieval find the right section, and near the top?
//   MRR           - mean reciprocal rank of the gold section
//   Diversity@10  - avg distinct sections in the top-10 (quantifies the
//                   version-duplication problem: lower = more pollution)
//
// Usage:
//   node eval/score.mjs
//   HAL_EVAL_VERBOSE=1 node eval/score.mjs   # print every question, not just misses

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { embed, searchByVector, canonicalHref, EMBED_MODEL } from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTSET = join(__dirname, "testset.json");
const K = 10;
const VERBOSE = process.env.HAL_EVAL_VERBOSE === "1";

async function main() {
  const testset = JSON.parse(readFileSync(TESTSET, "utf8"));
  console.log(`[score] embed=${EMBED_MODEL} topK=${K} questions=${testset.length}\n`);

  let recall1 = 0;
  let recall5 = 0;
  let recall10 = 0;
  let mrrSum = 0;
  let diversitySum = 0;
  const misses = [];

  for (const t of testset) {
    const vec = await embed(t.question);
    const hits = await searchByVector(vec, { product: t.product, limit: K });
    const canonList = hits.map((h) => canonicalHref(h.payload?.href || ""));

    // Rank (1-based) of the first hit whose canonical section matches the gold.
    let rank = 0;
    for (let i = 0; i < canonList.length; i++) {
      if (canonList[i] === t.gold_canonical_href) {
        rank = i + 1;
        break;
      }
    }
    const distinct = new Set(canonList).size;
    diversitySum += distinct;

    if (rank === 1) recall1++;
    if (rank >= 1 && rank <= 5) recall5++;
    if (rank >= 1 && rank <= 10) recall10++;
    if (rank > 0) mrrSum += 1 / rank;

    if (rank === 0) misses.push(t);
    if (VERBOSE || rank === 0) {
      const mark = rank === 0 ? "MISS" : `rank ${rank}`;
      console.log(`${t.id} [${t.product}] ${mark} | distinct@${K}=${distinct}/${hits.length}`);
      console.log(`   Q: ${t.question}`);
      console.log(`   gold: ${t.gold_canonical_href}`);
    }
  }

  const n = testset.length || 1;
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`\n===== RETRIEVAL BASELINE (n=${testset.length}, topK=${K}) =====`);
  console.log(`Recall@1  : ${pct(recall1)}  (${recall1}/${testset.length})`);
  console.log(`Recall@5  : ${pct(recall5)}  (${recall5}/${testset.length})`);
  console.log(`Recall@10 : ${pct(recall10)}  (${recall10}/${testset.length})`);
  console.log(`MRR       : ${(mrrSum / n).toFixed(3)}`);
  console.log(`Diversity : ${(diversitySum / n).toFixed(1)} distinct sections per top-${K} (max ${K}) -> lower = more version-dup pollution`);
  if (misses.length) console.log(`Misses    : ${misses.length} (${misses.map((m) => m.id).join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
