// wait-for-qdrant.mjs
//
// Poll Qdrant /readyz until it responds or a timeout elapses. Used by the
// `qdrant:up` npm flow so a follow-up push doesn't race container startup.
//
// Usage: node scripts/wait-for-qdrant.mjs [timeoutSeconds]

import { ping, qdrantUrl } from "../server/qdrant-client.mjs";

const timeoutSec = Number(process.argv[2] || 60);
const deadline = Date.now() + timeoutSec * 1000;

async function wait() {
  process.stdout.write(`Waiting for Qdrant at ${qdrantUrl()} `);
  while (Date.now() < deadline) {
    if (await ping(1500)) {
      process.stdout.write(" ready.\n");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\n");
  console.error(`Qdrant did not become ready within ${timeoutSec}s.`);
  process.exit(1);
}

wait();
