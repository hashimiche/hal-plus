// qdrant-client.mjs
//
// Minimal, dependency-free Qdrant REST client shared by the ingest script
// (scripts/push-to-qdrant.mjs) and the server-side retrieval backend
// (doc-search.mjs). Uses the global fetch (Node 18+), no SDK.
//
// Collection contract (must match between push + query):
//   vectors: { size: 768, distance: "Cosine" }   -- nomic-embed-text dim
//   payload keyword indexes: product, source_type -- enables filtered search
//
// Env:
//   HAL_QDRANT_URL         (default http://127.0.0.1:6333)
//   HAL_QDRANT_COLLECTION  (default hal-plus)

import crypto from "crypto";

export const QDRANT_VECTOR_SIZE = 768; // nomic-embed-text output dimension
export const QDRANT_DISTANCE = "Cosine";

export function qdrantUrl() {
  return String(process.env.HAL_QDRANT_URL || "http://127.0.0.1:6333").replace(/\/+$/, "");
}

export function qdrantCollection() {
  return String(process.env.HAL_QDRANT_COLLECTION || "hal-plus");
}

// Stable deterministic UUID (v4 shape) from an arbitrary chunk string id, so
// re-ingesting the same chunk overwrites in place instead of duplicating.
export function chunkIdToUuid(chunkId) {
  const hash = crypto.createHash("md5").update(String(chunkId)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(
    16,
    20
  )}-${hash.slice(20, 32)}`;
}

// Derive a coarse source_type from a documentation href. The corpus today is
// docs + tutorials; richer types (validated-design, validated-pattern, video)
// are added as those sources are ingested.
export function deriveSourceType(href) {
  const h = String(href || "").toLowerCase();
  if (h.includes("/tutorials/")) return "tutorial";
  if (h.includes("/validated-designs") || h.includes("/validated-design")) return "validated-design";
  if (h.includes("/validated-patterns") || h.includes("/validated-pattern")) return "validated-pattern";
  if (h.includes("youtube.com") || h.includes("youtu.be")) return "video";
  return "docs";
}

async function request(method, path, body) {
  const resp = await fetch(`${qdrantUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Qdrant ${method} ${path} -> ${resp.status}: ${text}`);
  }
  return resp.json();
}

export async function ping(timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${qdrantUrl()}/readyz`, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectionExists() {
  try {
    await request("GET", `/collections/${qdrantCollection()}`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureCollection({ recreate = false } = {}) {
  const name = qdrantCollection();
  if (recreate) {
    try {
      await request("DELETE", `/collections/${name}`);
    } catch {
      /* may not exist */
    }
  } else if (await collectionExists()) {
    return false;
  }

  await request("PUT", `/collections/${name}`, {
    vectors: { size: QDRANT_VECTOR_SIZE, distance: QDRANT_DISTANCE },
  });
  // Keyword payload indexes enable efficient filtered retrieval.
  for (const field of ["product", "source_type"]) {
    await request("PUT", `/collections/${name}/index`, {
      field_name: field,
      field_schema: "keyword",
    });
  }
  return true;
}

export async function upsertPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return;
  await request("PUT", `/collections/${qdrantCollection()}/points`, { points });
}

export async function searchPoints({ vector, filter, limit = 24, scoreThreshold, withPayload = true }) {
  const body = {
    vector,
    limit,
    with_payload: withPayload,
    with_vector: false,
    ...(filter ? { filter } : {}),
    ...(typeof scoreThreshold === "number" ? { score_threshold: scoreThreshold } : {}),
  };
  const data = await request("POST", `/collections/${qdrantCollection()}/points/search`, body);
  return Array.isArray(data?.result) ? data.result : [];
}

export async function scrollPayloadValues(field, { pageLimit = 1000, maxPages = 200 } = {}) {
  const seen = new Set();
  let offset = null;
  let page = 0;
  do {
    const body = {
      with_payload: [field],
      with_vector: false,
      limit: pageLimit,
      ...(offset !== null ? { offset } : {}),
    };
    const data = await request("POST", `/collections/${qdrantCollection()}/points/scroll`, body);
    for (const point of data?.result?.points ?? []) {
      const value = point?.payload?.[field];
      if (value !== undefined && value !== null) seen.add(value);
    }
    offset = data?.result?.next_page_offset ?? null;
    page++;
  } while (offset !== null && page < maxPages);
  return seen;
}

export function matchFilter(conditions) {
  const must = Object.entries(conditions)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => ({ key, match: { value } }));
  return must.length > 0 ? { must } : undefined;
}
