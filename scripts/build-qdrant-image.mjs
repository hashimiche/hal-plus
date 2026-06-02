// build-qdrant-image.mjs
//
// Bake a pre-seeded Qdrant corpus image: start a throwaway Qdrant container,
// replay an exported seed (id + vector + payload) into the `hal-plus`
// collection, then `commit` the container filesystem (storage included) into a
// distributable image. The base qdrant/qdrant image declares no VOLUME for
// /qdrant/storage, so committing captures the seeded data.
//
// Usage:
//   node scripts/build-qdrant-image.mjs [--seed <file>] [--image <ref>]
//                                       [--engine <podman|docker>] [--port <n>]
//                                       [--base <ref>] [--keep]
//
// Defaults: seed=.qdrant-build/seed.jsonl,
//           image=ghcr.io/hashimiche/hal-plus-qdrant:latest,
//           engine=podman, port=6399, base=qdrant/qdrant:v1.13.6
//
// After a successful build, push with:
//   <engine> push <image>

import fs from "node:fs";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { ensureCollection, upsertPoints } from "../server/qdrant-client.mjs";

function parseArgs(argv) {
  const args = {
    seed: ".qdrant-build/seed.jsonl",
    image: "ghcr.io/hashimiche/hal-plus-qdrant:latest",
    engine: "podman",
    port: "6399",
    base: "qdrant/qdrant:v1.13.6",
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") args.keep = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
  }
  return args;
}

const BUILD_CONTAINER = "hal-qdrant-build";

function sh(engine, args, opts = {}) {
  return execFileSync(engine, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }).trim();
}

function tryShallow(engine, args) {
  try {
    return sh(engine, args);
  } catch {
    return "";
  }
}

async function waitReady(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/readyz`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

async function pointCount(url, collection) {
  const r = await fetch(`${url}/collections/${collection}/points/count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exact: true }),
  });
  const j = await r.json();
  return j?.result?.count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.seed)) {
    throw new Error(`seed file not found: ${args.seed} (run 'npm run qdrant:export' first)`);
  }

  const url = `http://127.0.0.1:${args.port}`;
  process.env.HAL_QDRANT_URL = url;
  const collection = process.env.HAL_QDRANT_COLLECTION || "hal-plus";

  // Clean any stale build container.
  tryShallow(args.engine, ["rm", "-f", BUILD_CONTAINER]);

  console.log(`🐳 Starting throwaway Qdrant (${args.base}) on ${url} ...`);
  sh(args.engine, ["run", "-d", "--name", BUILD_CONTAINER, "-p", `${args.port}:6333`, args.base]);

  try {
    if (!(await waitReady(url))) throw new Error("Qdrant did not become ready in time");

    console.log("📦 Creating collection schema ...");
    await ensureCollection({ recreate: true });

    console.log(`⬆️  Replaying seed ${args.seed} ...`);
    const rl = readline.createInterface({ input: fs.createReadStream(args.seed), crlfDelay: Infinity });
    let batch = [];
    let total = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const p = JSON.parse(line);
      batch.push({ id: p.id, vector: p.vector, payload: p.payload });
      if (batch.length >= 256) {
        await upsertPoints(batch);
        total += batch.length;
        batch = [];
        if (total % 2560 === 0) process.stdout.write(`\r   upserted ${total} ...`);
      }
    }
    if (batch.length) {
      await upsertPoints(batch);
      total += batch.length;
    }
    process.stdout.write(`\r   upserted ${total} points       \n`);

    const count = await pointCount(url, collection);
    console.log(`🔎 Verified point count: ${count}`);
    if (count !== total) {
      throw new Error(`count mismatch: replayed ${total} but collection has ${count}`);
    }

    // Stop cleanly so Qdrant flushes WAL/segments to /qdrant/storage before commit.
    console.log("💾 Stopping container to flush storage ...");
    sh(args.engine, ["stop", BUILD_CONTAINER]);

    console.log(`🏗️  Committing seeded filesystem -> ${args.image} ...`);
    sh(args.engine, ["commit", BUILD_CONTAINER, args.image]);

    console.log(`✅ Built pre-seeded image: ${args.image}`);
    console.log(`   Push it with: ${args.engine} push ${args.image}`);
  } finally {
    if (!args.keep) {
      tryShallow(args.engine, ["rm", "-f", BUILD_CONTAINER]);
    } else {
      console.log(`ℹ️  Keeping build container '${BUILD_CONTAINER}' (--keep)`);
    }
  }
}

main().catch((err) => {
  console.error(`❌ build failed: ${err.message}`);
  process.exit(1);
});
