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
import { deterministicIntentResponse } from "./deterministic-engine.mjs";
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
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4";
const OLLAMA_CONTEXT_WINDOW = Number(process.env.OLLAMA_CONTEXT_WINDOW || 32768);
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
  res.json({ ok: true, model: OLLAMA_MODEL, ollama: OLLAMA_BASE_URL });
});

app.get("/api/status", async (_req, res) => {
  try {
    const [baseline, runtimeCatalog, llmRuntime] = await Promise.all([
      callMcpWithFallback("hal_status_baseline", ["get_runtime_status"], {}),
      halMcpClient.getRuntimeCatalog().catch(() => null),
      getOllamaRuntime(OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_CONTEXT_WINDOW)
    ]);
    const runtime = baseline?.structuredContent?.data?.runtime || null;
    const products = baselineProductsToUi(runtime);
    const lokiReady = lokiStateFromBaseline(runtime);
    const capabilityCount = Array.isArray(runtimeCatalog?.actions) ? runtimeCatalog.actions.length : 0;
    const toolCount = Array.isArray(runtimeCatalog?.toolNames) ? runtimeCatalog.toolNames.length : 0;
    const skillsCount = Number(runtimeCatalog?.skills?.skills_count || 0);
    const missingTools = missingCoreMcpTools(runtimeCatalog, null);
    const discoveryAvailable = Boolean(runtimeCatalog);
    const mcpOk = !baseline?.isError && discoveryAvailable && missingTools.length === 0;

    res.json({
      runtime: {
        loki: {
          ok: lokiReady,
          detail: lokiReady
            ? "Observability stack · loki enabled"
            : "Observability stack · loki not enabled"
        },
        llm: llmRuntime,
        halMcp: {
          ok: mcpOk,
          detail: mcpOk
            ? `HAL MCP runtime tools ready (${toolCount} tools, ${capabilityCount} actions, ${skillsCount} skills)`
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
    const [runtimePolicy, runtimeCatalog, docSearch] = await Promise.all([
      getRuntimePolicy(),
      halMcpClient.getRuntimeCatalog().catch(() => null),
      docsForPromptWithFallback(prompt, behaviorContext).catch(() => ({ docs: [], chunks: [], mode: "error" }))
    ]);
    const behaviorCoverage = evaluateBehaviorMcpCoverage(behaviorContext, runtimeCatalog, runtimePolicy);
    const behaviorGrounding = await gatherBehaviorGrounding(behaviorContext, halMcpClient, runtimeCatalog, prompt).catch(() => null);
    const systemPrompt = buildSystemPrompt(
      runtimePolicy,
      [
        buildBehaviorPromptSupplement(behaviorContext),
        buildMcpCoveragePromptSupplement(behaviorCoverage),
        buildGroundingPromptSupplement(behaviorGrounding),
        buildDocSearchPromptSupplement(docSearch)
      ]
        .filter(Boolean)
        .join("\n\n")
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...inputMessages
        .filter((m) => typeof m?.role === "string" && typeof m?.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    ];

    const deterministicReply = await deterministicIntentResponse(prompt, behaviorContext, behaviorGrounding, behaviorCoverage, docSearch);
    if (deterministicReply) {
      await streamSSESections(res, deterministicReply, { delayMs: 80 });
      return;
    }

    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages,
        options: {
          temperature: 0.2
        }
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
