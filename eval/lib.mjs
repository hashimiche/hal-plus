// eval/lib.mjs
//
// Shared helpers for the retrieval eval harness. Talks to the SAME Qdrant
// collection and Ollama instance hal+ uses at runtime, so measurements reflect
// real retrieval behaviour. Dependency-free (Node 18+ global fetch).

import { qdrantUrl, qdrantCollection, matchFilter } from "../server/qdrant-client.mjs";

export const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
export const GEN_MODEL = String(process.env.HAL_EVAL_GEN_MODEL || "gemma4:latest");
export const EMBED_MODEL = String(process.env.HAL_EVAL_EMBED_MODEL || "nomic-embed-text");

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`POST ${url} -> ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

const collectionBase = () => `${qdrantUrl()}/collections/${qdrantCollection()}`;

// Scroll every point id in the collection (optionally filtered by product).
// Lightweight: no payload, no vectors.
export async function scrollAllIds({ product } = {}) {
  const filter = product ? matchFilter({ product }) : undefined;
  const ids = [];
  let offset = null;
  for (let page = 0; page < 1000; page++) {
    const body = { limit: 1000, with_payload: false, with_vector: false };
    if (filter) body.filter = filter;
    if (offset !== null) body.offset = offset;
    const data = await postJson(`${collectionBase()}/points/scroll`, body);
    for (const p of data?.result?.points ?? []) ids.push(p.id);
    offset = data?.result?.next_page_offset ?? null;
    if (offset === null) break;
  }
  return ids;
}

// Fetch full points (with payload) for a set of ids.
export async function retrievePoints(ids) {
  if (!ids.length) return [];
  const data = await postJson(`${collectionBase()}/points`, {
    ids,
    with_payload: true,
    with_vector: false,
  });
  return data?.result ?? [];
}

// Vector search (the retrieval operation), product-filtered.
export async function searchByVector(vector, { product, limit = 10, scoreThreshold } = {}) {
  const body = { vector, limit, with_payload: true, with_vector: false };
  const filter = product ? matchFilter({ product }) : undefined;
  if (filter) body.filter = filter;
  if (typeof scoreThreshold === "number") body.score_threshold = scoreThreshold;
  const data = await postJson(`${collectionBase()}/points/search`, body);
  return data?.result ?? [];
}

// Text -> 768-dim vector via Ollama nomic-embed-text.
export async function embed(text) {
  const data = await postJson(`${OLLAMA_BASE_URL}/api/embed`, { model: EMBED_MODEL, input: text });
  const v = Array.isArray(data?.embeddings) ? data.embeddings[0] : null;
  if (!Array.isArray(v) || v.length === 0) throw new Error("embedding failed / empty");
  return v;
}

// Non-streaming text generation via Ollama.
export async function generate(prompt, { system, temperature = 0.4 } = {}) {
  const data = await postJson(`${OLLAMA_BASE_URL}/api/generate`, {
    model: GEN_MODEL,
    prompt,
    ...(system ? { system } : {}),
    stream: false,
    options: { temperature },
  });
  return String(data?.response || "").trim();
}

// Strip a HashiCorp doc version segment (…/v1.18.x/… or …/v1.2.3/…) so every
// version copy of a section shares one canonical key. Fragment (#anchor) kept.
export function canonicalHref(href) {
  return String(href || "").replace(/\/v\d+\.\d+\.(?:x|\d+)(?=\/)/g, "");
}

// Fisher–Yates sample of n items (non-mutating).
export function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
