// eval/rerank.mjs
//
// POC: LLM-as-reranker (two-stage retrieval), measured against the test set.
//
//   Stage 1: vector search top-N candidates (bi-encoder, fast, recall).
//   Stage 2: ask the local LLM to reorder those N by relevance (listwise).
//
// We score BOTH orderings on the SAME candidate set, so the delta isolates the
// reranker's effect. The reranker can only reorder what Stage 1 retrieved, so
// reranked Recall@10 can rise (pulling a gold from rank 11-20 into the top-10)
// and Recall@1 / MRR should rise most.
//
// Usage:
//   node eval/rerank.mjs
//   HAL_EVAL_VERBOSE=1 node eval/rerank.mjs
//   HAL_EVAL_CANDIDATES=30 HAL_EVAL_GEN_MODEL=qwen3.5:9b node eval/rerank.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  embed,
  searchByVector,
  generate,
  canonicalHref,
  EMBED_MODEL,
  GEN_MODEL,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTSET = join(__dirname, "testset.json");
const N = Number(process.env.HAL_EVAL_CANDIDATES || 20); // stage-1 shortlist size
const K = 10; // final cutoff for scoring
const VERBOSE = process.env.HAL_EVAL_VERBOSE === "1";

const SYSTEM = [
  "You are a search-result re-ranker for HashiCorp documentation.",
  "Given a user question and a numbered list of candidate doc sections, order the candidates from MOST to LEAST relevant for answering the question.",
  "Judge by whether the section actually answers the specific question, not just whether it shares keywords.",
  "Output ONLY a JSON array of the candidate numbers in ranked order, e.g. [3,1,8,2]. Include every number exactly once. No prose.",
].join("\n");

function buildRerankPrompt(question, candidates) {
  const lines = [`Question: ${question}`, "", "Candidates:"];
  candidates.forEach((c, i) => {
    const loc = c.payload?.headingPath || c.payload?.sectionTitle || c.payload?.sourceTitle || "";
    const snip = String(c.payload?.content || "").replace(/\s+/g, " ").slice(0, 300);
    lines.push(`${i + 1}. [${loc}] ${snip}`);
  });
  lines.push("", "Ranked order (JSON array of numbers):");
  return lines.join("\n");
}

// Parse "[3,1,8,...]" -> zero-based order; append any missing indices in their
// original order; fall back to identity order on total parse failure.
function parseOrder(raw, n) {
  const m = String(raw || "").match(/\[[\s\S]*?\]/);
  let nums = [];
  if (m) {
    try {
      nums = JSON.parse(m[0]);
    } catch {
      nums = [];
    }
  }
  const seen = new Set();
  const order = [];
  for (const v of nums) {
    const idx = Number(v) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < n && !seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i); // append the rest
  return order;
}

function rankOfGold(canonList, goldCanon) {
  for (let i = 0; i < Math.min(K, canonList.length); i++) {
    if (canonList[i] === goldCanon) return i + 1;
  }
  return 0;
}

const newAcc = () => ({ r1: 0, r5: 0, r10: 0, mrr: 0, div: 0 });

function accumulate(acc, canonList, goldCanon) {
  const rank = rankOfGold(canonList, goldCanon);
  if (rank === 1) acc.r1++;
  if (rank >= 1 && rank <= 5) acc.r5++;
  if (rank >= 1 && rank <= 10) acc.r10++;
  if (rank > 0) acc.mrr += 1 / rank;
  acc.div += new Set(canonList.slice(0, K)).size;
  return rank;
}

function report(label, acc, n) {
  const pct = (x) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(
    `${label.padEnd(9)} R@1 ${pct(acc.r1).padStart(6)} | R@5 ${pct(acc.r5).padStart(6)} | R@10 ${pct(acc.r10).padStart(6)} | MRR ${(acc.mrr / n).toFixed(3)} | Div ${(acc.div / n).toFixed(1)}`
  );
}

async function main() {
  const testset = JSON.parse(readFileSync(TESTSET, "utf8"));
  console.log(`[rerank] embed=${EMBED_MODEL} reranker=${GEN_MODEL} candidates=${N} k=${K} questions=${testset.length}\n`);
  const base = newAcc();
  const reranked = newAcc();

  for (const t of testset) {
    const vec = await embed(t.question);
    const cands = await searchByVector(vec, { product: t.product, limit: N });
    if (cands.length === 0) continue;

    const baseCanon = cands.map((h) => canonicalHref(h.payload?.href || ""));
    const baseRank = accumulate(base, baseCanon, t.gold_canonical_href);

    let order;
    try {
      const raw = await generate(buildRerankPrompt(t.question, cands), { system: SYSTEM, temperature: 0 });
      order = parseOrder(raw, cands.length);
    } catch (err) {
      console.error(`[rerank] ${t.id} rerank failed (${err.message}); keeping vector order`);
      order = cands.map((_, i) => i);
    }
    const rrCanon = order.map((i) => baseCanon[i]);
    const rrRank = accumulate(reranked, rrCanon, t.gold_canonical_href);

    if (VERBOSE) {
      console.log(`${t.id} [${t.product}] vector ${baseRank || "MISS"} -> reranked ${rrRank || "MISS"}`);
    }
  }

  const n = testset.length || 1;
  console.log(`\n===== BASELINE vs RERANKED (n=${testset.length}, candidates=${N}, k=${K}) =====`);
  report("baseline", base, n);
  report("reranked", reranked, n);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
