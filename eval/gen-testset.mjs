// eval/gen-testset.mjs
//
// STEP 1 of the retrieval eval harness: build a synthetic test set.
//
// For a random sample of real chunks from Qdrant, ask the LLM to write ONE
// natural question that chunk answers. This yields (question -> known-correct
// chunk) pairs with ZERO manual labelling: because the question was generated
// FROM a specific chunk, we already know the gold answer.
//
// Output: eval/testset.json  (consumed by eval/score.mjs in Step 2)
//
// Usage:
//   node eval/gen-testset.mjs                       # 10 questions per product
//   HAL_EVAL_PER_PRODUCT=3 node eval/gen-testset.mjs
//   HAL_EVAL_GEN_MODEL=qwen3.5:9b node eval/gen-testset.mjs

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  scrollAllIds,
  retrievePoints,
  generate,
  canonicalHref,
  sample,
  GEN_MODEL,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTS = (process.env.HAL_EVAL_PRODUCTS || "terraform,vault")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PER_PRODUCT = Number(process.env.HAL_EVAL_PER_PRODUCT || 10);
const MIN_CONTENT = 200; // skip thin / nav chunks
// Low-signal / navigation-artifact anchors that produce vague or meta questions.
const JUNK_FRAGMENT_RE = /^#(sidebar-label|overview|introduction|table-of-contents|toc|resources|next-steps|related-content|reference)$/i;
const OUT = join(__dirname, "testset.json");

const SYSTEM = [
  "You write realistic questions a HashiCorp practitioner would type into a documentation assistant.",
  "Given one documentation excerpt, output exactly ONE natural question that this specific excerpt answers.",
  "Rules:",
  "- Ask like a real user about the product/task. Never mention 'the text', 'the excerpt', 'this section', 'above', or 'the documentation'.",
  "- Do NOT copy long phrases verbatim; paraphrase naturally.",
  "- Output only the question. No preamble, no quotes, no numbering.",
].join("\n");

function cleanQuestion(raw) {
  let q = String(raw || "").trim();
  q = (q.split("\n").map((l) => l.trim()).filter(Boolean)[0]) || q; // first non-empty line
  q = q.replace(/^["'`]+|["'`]+$/g, "");
  q = q.replace(/^(question|q)\s*[:\-]\s*/i, "");
  return q.trim();
}

// A chunk is usable gold if it is substantive prose in a real (non-nav) section.
function isUsableGold(pl) {
  if ((pl.type || "text") !== "text") return false;
  const href = String(pl.href || "");
  const frag = href.includes("#") ? `#${href.split("#").pop()}` : "";
  if (JUNK_FRAGMENT_RE.test(frag)) return false;
  if (!String(pl.sectionTitle || "").trim()) return false;
  const content = String(pl.content || "").replace(/\s+/g, " ").trim();
  if (content.length < MIN_CONTENT) return false;
  if (!/[.!?]/.test(content)) return false; // require at least one full sentence
  return true;
}

// Pick n substantive, canonically-distinct text chunks for a product.
async function pickChunks(product, n) {
  const ids = await scrollAllIds({ product });
  const pool = sample(ids, Math.min(ids.length, n * 12));
  const picked = [];
  const seenCanon = new Set();
  for (let i = 0; i < pool.length && picked.length < n; i += 20) {
    const points = await retrievePoints(pool.slice(i, i + 20));
    for (const p of points) {
      const pl = p.payload || {};
      if (!isUsableGold(pl)) continue;
      const canon = canonicalHref(pl.href || "");
      if (seenCanon.has(canon)) continue; // avoid near-duplicate version sections
      seenCanon.add(canon);
      picked.push({ pointId: p.id, payload: pl });
      if (picked.length >= n) break;
    }
  }
  return picked;
}

async function main() {
  console.log(`[gen] model=${GEN_MODEL} products=${PRODUCTS.join(",")} perProduct=${PER_PRODUCT}`);
  const testset = [];
  let qid = 0;
  for (const product of PRODUCTS) {
    const chunks = await pickChunks(product, PER_PRODUCT);
    console.log(`[gen] ${product}: ${chunks.length} chunks selected`);
    for (const { pointId, payload } of chunks) {
      const excerpt = String(payload.content || "").replace(/\s+/g, " ").slice(0, 1200);
      const prompt = `Product: ${product}\nSection: ${payload.headingPath || payload.sectionTitle || ""}\n\nExcerpt:\n${excerpt}\n\nQuestion:`;
      let question = "";
      try {
        question = cleanQuestion(await generate(prompt, { system: SYSTEM }));
      } catch (err) {
        console.error(`[gen] generate failed for ${pointId}: ${err.message}`);
        continue;
      }
      if (!question || question.length < 8) continue;
      const record = {
        id: `q${String(++qid).padStart(3, "0")}`,
        product,
        question,
        gold_point_id: pointId,
        gold_chunk_id: payload.id || null,
        gold_href: payload.href || "",
        gold_canonical_href: canonicalHref(payload.href || ""),
        heading_path: payload.headingPath || "",
        section_title: payload.sectionTitle || "",
      };
      testset.push(record);
      console.log(`  ${record.id} [${product}] ${question}`);
    }
  }
  mkdirSync(__dirname, { recursive: true });
  writeFileSync(OUT, JSON.stringify(testset, null, 2));
  console.log(`\n[gen] wrote ${testset.length} questions -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
