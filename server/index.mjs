import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBehaviorCatalogSummary,
  buildBehaviorPromptSupplement,
  collectBehaviorResources,
  resolveBehaviorContext
} from "./behavior-registry.mjs";
import {
  buildGroundingPromptSupplement,
  buildMcpCoveragePromptSupplement,
  evaluateBehaviorMcpCoverage,
  gatherBehaviorGrounding
} from "./behavior-grounding.mjs";
import { createHalExecutableResolver } from "./hal-exec.mjs";
import { createHalMcpClient } from "./hal-mcp-client.mjs";
import { createPolicyEngine } from "./policy-engine.mjs";
import { deterministicIntentResponse, isCodeIntent, isFollowUpPrompt, isStatusQuestion } from "./deterministic-engine.mjs";
import { buildDocSearchPromptSupplement, retrieveDocsForPrompt } from "./doc-search.mjs";
import { baselineProductsToUi, getOllamaRuntime, lokiStateFromBaseline } from "./runtime-status.mjs";
import { streamSSESections, streamSSEText, proxyOllamaStreamToSSE } from "./sse.mjs";

const app = express();
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");

const PORT = Number(process.env.API_PORT || 9001);
const HOST = process.env.API_HOST || "127.0.0.1";

function isContainerRuntime() {
  if (String(process.env.HAL_PLUS_CONTAINER_MODE || "").trim().toLowerCase() === "true") {
    return true;
  }

  if (String(process.env.container || "").trim() !== "") {
    return true;
  }

  if (fs.existsSync("/.dockerenv")) {
    return true;
  }

  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    return /(docker|podman|containerd|kubepods)/i.test(cgroup);
  } catch {
    return false;
  }
}

function resolveOllamaBaseUrl() {
  const configured = String(process.env.OLLAMA_BASE_URL || "").trim();
  if (configured) {
    return configured;
  }

  if (isContainerRuntime()) {
    const hostAlias = String(process.env.OLLAMA_HOST_INTERNAL || "host.containers.internal").trim();
    return `http://${hostAlias}:11434`;
  }

  return "http://127.0.0.1:11434";
}

const OLLAMA_BASE_URL = resolveOllamaBaseUrl();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5";
const OLLAMA_MODEL_LABEL = process.env.OLLAMA_MODEL_LABEL || OLLAMA_MODEL;
const OLLAMA_CONTEXT_WINDOW = Number(process.env.OLLAMA_CONTEXT_WINDOW || 32768);
const OLLAMA_KEEP_ALIVE = String(process.env.OLLAMA_KEEP_ALIVE || "5m").trim() || "5m";
const POLICY_CACHE_TTL_MS = Number(process.env.HAL_POLICY_CACHE_TTL_MS || 30000);
const resolveHalExecutable = createHalExecutableResolver();
const halMcpClient = createHalMcpClient(resolveHalExecutable);
const { getRuntimePolicy, buildSystemPrompt, lastUserPrompt } = createPolicyEngine(halMcpClient, POLICY_CACHE_TTL_MS);
function missingCoreMcpTools(runtimeCatalog, runtimePolicy = null) {
  const required = Array.isArray(runtimePolicy?.tool_policy?.required_prefetch_tools)
    ? runtimePolicy.tool_policy.required_prefetch_tools
    : ["hal_status_baseline", "get_capabilities", "hal_policy_profile", "validate_command"];
  const available = new Set(Array.isArray(runtimeCatalog?.toolNames) ? runtimeCatalog.toolNames : []);
  return required.filter((toolName) => !available.has(toolName));
}

function isEngineUnavailableBaselineError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("no container engine found");
}

// Probe a product health endpoint — tries each URL candidate in order and returns
// true on the first reachable one. Accepts any HTTP response (including Vault-style
// non-200 health codes) as "up"; only network errors count as "down".
async function probeAny(candidates, { timeoutMs = 3000 } = {}) {
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      // Any HTTP response means the service is up (Vault returns 429/472/473/503 for standby/sealed)
      if (response.status > 0) return true;
    } catch {
      // network error or timeout — try next candidate
    }
  }
  return false;
}

// TCP-level probe — works for non-HTTP services (LDAP, MySQL, etc.)
// Returns true if the port is open (connection accepted then closed).
async function fetchHalStatusProducts() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch("http://hal-status:9001/api/status", { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const snap = await response.json();
    // hal-status returns the same shape as the MCP baseline runtime: { products: [...] }
    const mapped = baselineProductsToUi(snap);
    return mapped.length > 0 ? mapped : null;
  } catch {
    return null;
  }
}

// For each product, define:
//   containerHost  — hostname reachable on hal-net (container-to-container)
//   localhostHost  — address reachable from the host (npm run dev)
//   healthPath     — standard health or ready endpoint
//   uiEndpoint     — display URL shown in the UI
//   name           — display label
const PRODUCT_PROBES = [
  {
    name: "Consul",
    containerHost: "hal-consul",
    localhostHost: "127.0.0.1",
    port: 8500,
    healthPath: "/v1/status/leader",
    uiEndpoint: "http://consul.localhost:8500"
  },
  {
    name: "Vault",
    containerHost: "hal-vault",
    localhostHost: "127.0.0.1",
    port: 8200,
    healthPath: "/v1/sys/health",
    uiEndpoint: "http://vault.localhost:8200"
  },
  {
    name: "Boundary",
    containerHost: "hal-boundary",
    localhostHost: "127.0.0.1",
    port: 9200,
    healthPath: "/v1/health",
    uiEndpoint: "http://boundary.localhost:9200"
  },
  {
    name: "Terraform Enterprise",
    containerHost: "hal-tfe",
    localhostHost: "127.0.0.1",
    port: 8443,
    healthPath: "/_health_check",
    scheme: "https",
    uiEndpoint: "https://tfe.localhost:8443"
  },
  {
    name: "Grafana",
    containerHost: "hal-grafana",
    localhostHost: "127.0.0.1",
    port: 3000,
    healthPath: "/api/health",
    uiEndpoint: "http://grafana.localhost:3000"
  },
  {
    name: "Prometheus",
    containerHost: "hal-prometheus",
    localhostHost: "127.0.0.1",
    port: 9090,
    healthPath: "/-/healthy",
    uiEndpoint: "http://prometheus.localhost:9090"
  },
  {
    name: "Loki",
    containerHost: "hal-loki",
    localhostHost: "127.0.0.1",
    port: 3100,
    healthPath: "/ready",
    uiEndpoint: "http://loki.localhost:3100"
  }
];

async function fallbackProductsFromEndpoints() {
  const results = await Promise.all(
    PRODUCT_PROBES.map(async (product) => {
      const scheme = product.scheme || "http";
      const candidates = [
        `${scheme}://${product.containerHost}:${product.port}${product.healthPath}`,
        `${scheme}://${product.localhostHost}:${product.port}${product.healthPath}`
      ];
      const up = await probeAny(candidates);
      return {
        name: product.name,
        state: up ? "running" : "not-deployed",
        endpoint: product.uiEndpoint,
        version: "-",
        features: []
      };
    })
  );

  // Group Grafana/Prometheus/Loki into a single Observability product row
  const obs = results.filter((r) => ["Grafana", "Prometheus", "Loki"].includes(r.name));
  const obsUp = obs.some((r) => r.state === "running");
  const obsFeatures = obs.map((r) => `${r.name.toLowerCase()}:${r.state === "running" ? "enabled" : "disabled"}`);
  const obsRow = {
    name: "Observability",
    state: obsUp ? "running" : "not-deployed",
    endpoint: "http://grafana.localhost:3000",
    version: "-",
    features: obsFeatures
  };

  // Probe Vault feature dependencies in parallel
  const vaultRow = results.find((r) => r.name === "Vault");
  if (vaultRow) {
    const [oidcUp, jwtUp, k8sUp] = await Promise.all([
      probeAny(["http://hal-keycloak:8080/health/ready", "http://127.0.0.1:8080/health/ready"]),
      probeAny(["http://hal-gitlab:80", "http://127.0.0.1:8929"]),
      probeAny(["https://kind-control-plane:6443/readyz", "https://127.0.0.1:6443/readyz"])
    ]);
    // audit/ldap/database require exec or TCP — leave as disabled in the fallback path
    vaultRow.features = [
      `audit:disabled`,
      `database:disabled`,
      `jwt:${jwtUp ? "enabled" : "disabled"}`,
      `k8s:${k8sUp ? "enabled" : "disabled"}`,
      `ldap:disabled`,
      `oidc:${oidcUp ? "enabled" : "disabled"}`
    ];
  }

  // Nomad: try the web UI / HTTP API on both hal-net name and localhost
  const nomadUp = await probeAny([
    "http://hal-nomad:4646/v1/agent/health",
    "http://127.0.0.1:4646/v1/agent/health"
  ]);
  const nomadRow = {
    name: "Nomad",
    state: nomadUp ? "running" : "not-deployed",
    endpoint: "http://nomad.localhost:4646",
    version: "-",
    features: []
  };

  const coreProducts = results.filter((r) => !["Grafana", "Prometheus", "Loki"].includes(r.name));
  const nomadIndex = coreProducts.findIndex((r) => r.name === "Boundary");
  coreProducts.splice(nomadIndex + 1, 0, nomadRow);

  return [...coreProducts, obsRow];
}

function resolveBehaviorContextFromConversation(inputMessages, prompt) {
  const direct = resolveBehaviorContext(prompt);
  if (direct?.primary) {
    return direct;
  }

  const recentUserPrompts = (inputMessages || [])
    .filter((m) => m?.role === "user" && typeof m?.content === "string")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .slice(-3);

  if (recentUserPrompts.length === 0) {
    return direct;
  }

  const mergedPrompt = recentUserPrompts.join("\n");
  const merged = resolveBehaviorContext(mergedPrompt);
  return merged?.primary ? merged : direct;
}

// Route C — extract the last behavior context that matched in this conversation.
// Used to ground follow-up prompts when no direct behavior match exists.
function lastMatchedBehaviorContext(inputMessages) {
  const userPrompts = (inputMessages || [])
    .filter((m) => m?.role === "user" && typeof m?.content === "string")
    .map((m) => m.content.trim())
    .filter(Boolean)
    .slice(-5) // look back up to 5 turns
    .reverse(); // most recent first

  for (const pastPrompt of userPrompts) {
    const ctx = resolveBehaviorContext(pastPrompt);
    if (ctx?.primary) {
      return ctx;
    }
  }
  return null;
}

async function callMcpWithFallback(primaryTool, fallbackTools, args = {}) {
  const primary = await halMcpClient.callTool(primaryTool, args);
  const primaryCode = String(primary?.structuredContent?.code || "").toLowerCase();
  const primaryMessage = String(primary?.structuredContent?.message || "").toLowerCase();
  if (!primary?.isError || !(primaryCode === "parse_error" && primaryMessage.includes("unknown tool"))) {
    return primary;
  }

  for (const fallbackTool of fallbackTools || []) {
    const fallback = await halMcpClient.callTool(fallbackTool, args);
    if (!fallback?.isError) {
      return fallback;
    }
  }

  return primary;
}

async function rankDocsForPrompt(prompt, context) {
  const resources = collectBehaviorResources(context).slice(0, 10);
  if (!prompt || resources.length === 0) {
    return [];
  }

  const promptPayload = resources.map((resource, index) => ({
    id: String(index + 1),
    title: resource.title,
    href: resource.href,
    description: resource.description || "",
    kind: resource.kind || "guide"
  }));

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Select the most relevant documentation for the user's HAL question. Prefer precise subtopic matches over broad product homepages. Return strict JSON only: {\"selected_ids\":[\"1\",\"2\"],\"reason\":\"...\"}. Select zero to four ids."
          },
          {
            role: "user",
            content: JSON.stringify({ question: prompt, candidates: promptPayload })
          }
        ],
        options: { temperature: 0.1 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama docs ranking failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = String(payload?.message?.content || "").trim();
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    const parsed = JSON.parse(jsonStart >= 0 && jsonEnd >= jsonStart ? content.slice(jsonStart, jsonEnd + 1) : content);
    const selectedIds = Array.isArray(parsed?.selected_ids) ? parsed.selected_ids.map((value) => String(value)) : [];
    const selected = promptPayload.filter((item) => selectedIds.includes(item.id));
    return selected.length > 0 ? selected : promptPayload.slice(0, 2);
  } catch {
    return promptPayload.slice(0, 2);
  }
}

async function docsForPromptWithFallback(prompt, context) {
  const search = await retrieveDocsForPrompt(prompt, context, { ollamaBaseUrl: OLLAMA_BASE_URL });
  if (Array.isArray(search.docs) && search.docs.length > 0) {
    return search;
  }

  if (search.mode === "disabled") {
    const fallbackDocs = await rankDocsForPrompt(prompt, context);
    return {
      docs: fallbackDocs,
      evidence: [],
      chunks: [],
      mode: "fallback-disabled-search"
    };
  }

  return {
    docs: [],
    evidence: [],
    chunks: [],
    mode: "no-match"
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: OLLAMA_MODEL_LABEL, runtimeModel: OLLAMA_MODEL, ollama: OLLAMA_BASE_URL, keepAlive: OLLAMA_KEEP_ALIVE });
});

app.get("/api/status", async (_req, res) => {
  try {
    const [baseline, runtimeCatalog, llmRuntime] = await Promise.all([
      callMcpWithFallback("hal_status_baseline", ["get_runtime_status"], {}),
      halMcpClient.getRuntimeCatalog().catch(() => null),
      getOllamaRuntime(OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_CONTEXT_WINDOW)
    ]);
    const runtime = baseline?.structuredContent?.data?.runtime || null;
    const baselineProducts = baselineProductsToUi(runtime);
    const halStatusProducts = await fetchHalStatusProducts();
    const products = baselineProducts.length > 0 ? baselineProducts : (halStatusProducts || await fallbackProductsFromEndpoints());
    const lokiReady = lokiStateFromBaseline(runtime);
    const capabilityCount = Array.isArray(runtimeCatalog?.actions) ? runtimeCatalog.actions.length : 0;
    const toolCount = Array.isArray(runtimeCatalog?.toolNames) ? runtimeCatalog.toolNames.length : 0;
    const skillsCount = Number(runtimeCatalog?.skills?.skills_count || 0);
    const missingTools = missingCoreMcpTools(runtimeCatalog, null);
    const discoveryAvailable = Boolean(runtimeCatalog);
    const mcpTransportOk = discoveryAvailable && missingTools.length === 0;
    const mcpRuntimeOk = !baseline?.isError;
    const baselineMessage = typeof baseline?.structuredContent?.message === "string"
      ? baseline.structuredContent.message.trim()
      : "";
    const engineUnavailable = isEngineUnavailableBaselineError(baselineMessage);

    res.json({
      runtime: {
        loki: {
          ok: lokiReady,
          detail: lokiReady
            ? "Observability stack · loki enabled"
            : "Observability stack · loki not enabled"
        },
        llm: {
          ...llmRuntime,
          model: OLLAMA_MODEL_LABEL,
          runtimeModel: OLLAMA_MODEL,
          keepAlive: OLLAMA_KEEP_ALIVE
        },
        halMcp: {
          ok: mcpTransportOk,
          runtimeOk: mcpRuntimeOk,
          url: String(process.env.HAL_MCP_HTTP_URL || "").trim() || null,
          detail: mcpTransportOk && mcpRuntimeOk
            ? `HAL MCP runtime tools ready (${toolCount} tools, ${capabilityCount} actions, ${skillsCount} skills)`
            : mcpTransportOk && !mcpRuntimeOk
              ? engineUnavailable
                ? `HAL MCP reachable over HTTP (${toolCount} tools)`
                : baselineMessage
                ? `HAL MCP reachable over HTTP, but runtime baseline failed: ${baselineMessage}`
                : "HAL MCP reachable over HTTP, but runtime baseline failed"
            : !discoveryAvailable
              ? "HAL MCP discovery unavailable"
              : missingTools.length > 0
                ? `HAL MCP missing required tools: ${missingTools.join(", ")}`
                : "HAL MCP runtime tools unavailable",
          missingTools
        }
      },
      products
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown status error";
    res.status(500).json({
      runtime: {
        loki: { ok: false, detail: "status unavailable" },
        llm: { ok: false, detail: "status unavailable" },
        halMcp: { ok: false, detail: "status unavailable" }
      },
      products: [],
      error: message
    });
  }
});

app.get("/api/catalog", (_req, res) => {
  try {
    res.json(buildBehaviorCatalogSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown catalog error";
    res.status(500).json({ error: message, products: [] });
  }
});

app.post("/api/docs", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const context = resolveBehaviorContext(prompt);
    const search = await docsForPromptWithFallback(prompt, context);
    res.json({ docs: search.docs, evidence: search.evidence || [], retrieval: { mode: search.mode, debug: search.debug || null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown docs error";
    res.status(500).json({ error: message, docs: [], evidence: [] });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const prompt = lastUserPrompt(inputMessages);
    const behaviorContext = resolveBehaviorContextFromConversation(inputMessages, prompt);

    // Route C: if no behavior matched and this looks like a follow-up, retrieve the last matched context
    // and inject its body as grounding so the model can answer contextually.
    const priorBehaviorContext = (!behaviorContext?.primary && isFollowUpPrompt(prompt))
      ? lastMatchedBehaviorContext(inputMessages)
      : null;
    const [runtimePolicy, runtimeCatalog, docSearch] = await Promise.all([
      getRuntimePolicy(),
      halMcpClient.getRuntimeCatalog().catch(() => null),
      docsForPromptWithFallback(prompt, behaviorContext).catch(() => ({ docs: [], chunks: [], mode: "error" }))
    ]);
    const behaviorCoverage = evaluateBehaviorMcpCoverage(behaviorContext, runtimeCatalog, runtimePolicy);
    const [behaviorGrounding, probeProducts] = await Promise.all([
      gatherBehaviorGrounding(behaviorContext, halMcpClient, runtimeCatalog, prompt).catch(() => null),
      fetchHalStatusProducts().then((r) => r || fallbackProductsFromEndpoints()).catch(() => [])
    ]);
    const systemPrompt = buildSystemPrompt(
      runtimePolicy,
      [
        buildBehaviorPromptSupplement(behaviorContext),
        // Route C: inject prior behavior body as follow-up grounding when current prompt has no match
        priorBehaviorContext ? `Prior conversation context (user is following up on: ${priorBehaviorContext.primary?.title || priorBehaviorContext.primary?.id}):\n\n${buildBehaviorPromptSupplement(priorBehaviorContext)}` : null,
        buildMcpCoveragePromptSupplement(behaviorCoverage),
        buildGroundingPromptSupplement(behaviorGrounding),
        buildDocSearchPromptSupplement(docSearch)
      ]
        .filter(Boolean)
        .join("\n\n"),
      { codeIntent: isCodeIntent(prompt) }
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...inputMessages
        .filter((m) => typeof m?.role === "string" && typeof m?.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    ];

    const deterministicReply = await deterministicIntentResponse(prompt, behaviorContext, behaviorGrounding, behaviorCoverage, docSearch, probeProducts);
    if (deterministicReply) {
      // Skip Qwen wrapping for status/health checks — they need to be instant.
      // Only operational answers (configure/deploy/enable) benefit from prose context.
      if (isStatusQuestion(prompt)) {
        await streamSSESections(res, deterministicReply, { delayMs: 80 });
        return;
      }
      // The model receives the MCP-verified commands as inviolable ground truth and must not modify them.
      const hybridSystemPrompt = [
        "You are HAL Plus, an educational HashiCorp Academy Labs assistant.",
        "The following is MCP-verified ground truth for this question. Your job is to write a natural, educational response that wraps this content.",
        "Rules:",
        "- Write 1-2 sentences of human intro BEFORE the grounded block explaining what this does and why.",
        "- Output the grounded block EXACTLY as provided, character for character — do not modify, reorder, or omit any commands, code blocks, or sections.",
        "- After the grounded block, add 1-2 sentences of practical insight only if it adds genuine value (e.g. a common pitfall, a next step, or an option the user may not know about).",
        "- Do not add new HAL commands or documentation links that are not already in the grounded block.",
        "- Do not add headers or change the structure of the grounded block.",
        "- Tone: direct, educational, warm — like a senior colleague explaining something to a peer.",
        "",
        "MCP-grounded block to wrap:",
        deterministicReply
      ].join("\n");

      const hybridMessages = [
        { role: "system", content: hybridSystemPrompt },
        { role: "user", content: prompt }
      ];

      const hybridResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          keep_alive: OLLAMA_KEEP_ALIVE,
          stream: true,
          think: false,
          messages: hybridMessages
        })
      });

      if (!hybridResponse.ok || !hybridResponse.body) {
        await streamSSESections(res, deterministicReply, { delayMs: 80 });
        return;
      }

      // Read from Qwen until we get the first real content chunk.
      // We must NOT commit res (write headers/body) before we know Qwen is actually streaming —
      // if Qwen fails before producing a chunk we fall back to streamSSESections cleanly.
      const hybridReader = hybridResponse.body.getReader();
      const hybridDecoder = new TextDecoder();
      let hybridBuffer = "";
      let firstChunk = null;

      try {
        outer: while (true) {
          const { done, value } = await hybridReader.read();
          if (done) break;
          hybridBuffer += hybridDecoder.decode(value, { stream: true });
          const lines = hybridBuffer.split("\n");
          hybridBuffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed;
            try { parsed = JSON.parse(trimmed); } catch { continue; }
            const content = parsed?.message?.content || "";
            if (content) { firstChunk = content; break outer; }
            if (parsed?.done) break outer;
          }
        }
      } catch {
        // Qwen stream failed before producing a chunk — fall back to deterministic
        await streamSSESections(res, deterministicReply, { delayMs: 80 });
        return;
      }

      if (!firstChunk) {
        // Qwen produced no content — fall back to deterministic
        await streamSSESections(res, deterministicReply, { delayMs: 80 });
        return;
      }

      // Qwen is alive — commit the response and stream the rest
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "meta", source: "hybrid", topic: behaviorContext?.primary?.id || priorBehaviorContext?.primary?.id || null })}

`);
      res.write(`data: ${JSON.stringify({ type: "chunk", content: firstChunk })}\n\n`);

      // Continue streaming remaining chunks
      try {
        while (true) {
          const { done, value } = await hybridReader.read();
          if (done) break;
          hybridBuffer += hybridDecoder.decode(value, { stream: true });
          const lines = hybridBuffer.split("\n");
          hybridBuffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed;
            try { parsed = JSON.parse(trimmed); } catch { continue; }
            const content = parsed?.message?.content || "";
            if (content) res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
            if (parsed?.done) {
              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              return;
            }
          }
        }
      } catch {
        // Stream interrupted after content started — best effort, just close
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        keep_alive: OLLAMA_KEEP_ALIVE,
        stream: true,
        messages
      })
    });

    if (!ollamaResponse.ok || !ollamaResponse.body) {
      const errBody = await ollamaResponse.text();
      res.status(502).json({ error: `Ollama error: ${errBody || ollamaResponse.statusText}` });
      return;
    }

    await proxyOllamaStreamToSSE(res, ollamaResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    res.end();
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`HAL Plus API running on http://${HOST}:${PORT}`);
});
