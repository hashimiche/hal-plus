// smoke-model.mjs
//
// One real call to a hosted model through server/model-client.mjs, to check the
// wire format and the strict JSON before the lesson pipeline (T07) relies on it.
// It sends one fixed French question through the lesson call (writeLesson) and
// prints the validated lesson, or the typed ModelClientError. It uses the
// module's own API only: no HTTP is written here.
//
// Usage (the key is read from your shell by the module, never passed here):
//
//   HAL_PROVIDER=anthropic HAL_MODEL=claude-sonnet-5-5 node scripts/smoke-model.mjs
//   HAL_PROVIDER=google    HAL_MODEL=gemini-3.8-flash  node scripts/smoke-model.mjs
//
// Keys (only the variable of the selected provider is read):
//   anthropic -> ANTHROPIC_API_KEY      google -> GEMINI_API_KEY
//   (openai -> OPENAI_API_KEY and xai -> XAI_API_KEY work the same way.)
// A missing key exits 1 with the variable name, never a value.
//
// Model ids, checked against the official docs on 2026-11-04:
//   claude-sonnet-5-5  "Claude API ID" of Claude Sonnet 5.5, released 2026-09-28,
//                      supports structured outputs (output_config.format).
//                      https://platform.claude.com/docs/en/about-claude/models
//                      (redirects to /docs/en/models/overview)
//                      https://platform.claude.com/docs/en/models/sonnet-5-5/overview
//   gemini-3.8-flash   used by the Interactions API structured-output recipe
//                      (same request as the module: Api-Revision 2026-05-20,
//                      response_format text + application/json + schema);
//                      its model page lists "Stable: gemini-3.8-flash" and
//                      "Structured outputs: supported".
//                      https://aistudio.google.com/docs/structured-output
//                      https://aistudio.google.com/docs/models/gemini-3.8-flash
//                      Alternative, badged "Stable" on https://aistudio.google.com/docs/models:
//                      gemini-3.6-flash (also lists structured outputs as supported).
//                      The docs describe no "stable Pro" id yet (only gemini-3.1-pro-preview).
//
// What a success looks like (stdout, exit code 0):
//
//   provider: anthropic
//   model:    claude-sonnet-5-5
//   elapsed:  4.2 s
//   result:   OK (strict JSON, 4 fields validated)
//   mechanism:     <a few sentences in French>
//   configuration: <a short snippet, or empty>
//   commands:      <0 to 3 lines>
//   documents:     <0 or more URLs>
//
// What a failure looks like (exit code 1): the same first three lines, then
//   result:    FAILED
//   code:      auth | rate_limit | server | bad_request | timeout | network |
//              refusal | truncated | unreadable_response | invalid_output | ...
//   status:    HTTP status, or "n/a"
//   requestId: provider request id, or "n/a"
// followed by the error message on stderr. A "unreadable_response" or
// "invalid_output" code means the wire format or the strict JSON is wrong,
// which is exactly what this script is meant to catch.
//
// This script never prints the key, a part of it, the raw response body, the
// response headers or a raw error object.

import { createModelClientFromEnv, ModelClientError } from "../server/model-client.mjs";

const TIMEOUT_MS = 60_000;

const SYSTEM = [
  "Tu es un assistant technique spécialisé dans les produits HashiCorp.",
  "Réponds en français, brièvement, en remplissant les quatre champs du JSON :",
  "mechanism (2 à 3 phrases), configuration (un court extrait de configuration, ou une chaîne vide),",
  "commands (au plus 3 commandes), documents (URLs de documentation officielle, tableau vide si tu n'es pas sûr).",
  "N'invente aucune URL."
].join(" ");

const QUESTION = "Comment connecter GitLab CI à Vault avec un JWT ?";

function seconds(startedAt) {
  return `${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
}

function printList(label, items) {
  if (items.length === 0) {
    console.log(`${label} (none)`);
    return;
  }
  console.log(label);
  for (const item of items) console.log(`  - ${item}`);
}

async function main() {
  let client;
  try {
    client = createModelClientFromEnv({ timeoutMs: TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ModelClientError) {
      console.error(err.message);
      console.error("Usage: HAL_PROVIDER=anthropic|google HAL_MODEL=<model id> node scripts/smoke-model.mjs");
    } else {
      console.error(`Unexpected error (${err?.name ?? "unknown"}) while reading the configuration.`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`provider: ${client.provider}`);
  console.log(`model:    ${client.model}`);

  const startedAt = performance.now();
  try {
    const lesson = await client.writeLesson({ system: SYSTEM, prompt: QUESTION });
    console.log(`elapsed:  ${seconds(startedAt)}`);
    console.log("result:   OK (strict JSON, 4 fields validated)");
    console.log(`mechanism:     ${lesson.mechanism}`);
    console.log(`configuration: ${lesson.configuration === "" ? "(empty)" : `\n${lesson.configuration}`}`);
    printList("commands:", lesson.commands);
    printList("documents:", lesson.documents);
  } catch (err) {
    console.log(`elapsed:  ${seconds(startedAt)}`);
    console.log("result:   FAILED");
    if (err instanceof ModelClientError) {
      console.log(`code:      ${err.code}`);
      console.log(`status:    ${err.status ?? "n/a"}`);
      console.log(`requestId: ${err.requestId ?? "n/a"}`);
      console.error(err.message);
    } else {
      // Never print a raw error object: it could carry request details.
      console.error(`Unexpected error (${err?.name ?? "unknown"}), not a ModelClientError.`);
    }
    process.exitCode = 1;
  }
}

await main();
