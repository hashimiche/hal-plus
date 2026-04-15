import express from "express";
import {
  buildBehaviorCatalogSummary,
  buildBehaviorPromptSupplement,
  collectBehaviorResources,
  resolveBehaviorContext
} from "./behavior-registry.mjs";
import { buildGroundingPromptSupplement, gatherBehaviorGrounding } from "./behavior-grounding.mjs";
import { createHalExecutableResolver } from "./hal-exec.mjs";
import { createHalMcpClient } from "./hal-mcp-client.mjs";
import { createPolicyEngine } from "./policy-engine.mjs";
import { deterministicIntentResponse } from "./deterministic-engine.mjs";
import { buildDocSearchPromptSupplement, retrieveDocsForPrompt } from "./doc-search.mjs";
import { baselineProductsToUi, getOllamaRuntime, lokiStateFromBaseline } from "./runtime-status.mjs";
import { streamSSESections, streamSSEText, proxyOllamaStreamToSSE } from "./sse.mjs";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.API_PORT || 9001);
const HOST = process.env.API_HOST || "127.0.0.1";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4";
const OLLAMA_CONTEXT_WINDOW = Number(process.env.OLLAMA_CONTEXT_WINDOW || 32768);
const POLICY_CACHE_TTL_MS = Number(process.env.HAL_POLICY_CACHE_TTL_MS || 30000);
const resolveHalExecutable = createHalExecutableResolver();
const halMcpClient = createHalMcpClient(resolveHalExecutable);
const { getRuntimePolicy, buildSystemPrompt, lastUserPrompt } = createPolicyEngine(halMcpClient, POLICY_CACHE_TTL_MS);

function resolveBehaviorContextWithIntentHints(prompt) {
  const base = resolveBehaviorContext(prompt);
  const lowerPrompt = String(prompt || "").toLowerCase();
  const looksLikeVcsIntent = ["vcs", "gitops", "pull request", "merge request", "workflow"].some((term) =>
    lowerPrompt.includes(term)
  );

  if (base?.primary && !(base.primary.subcommand === "product" && looksLikeVcsIntent)) {
    return base;
  }

  if (!looksLikeVcsIntent) {
    return base;
  }

  const hinted = resolveBehaviorContext(`${prompt} terraform enterprise tfe workspace vcs gitlab`);
  return hinted?.primary ? hinted : base;
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
      chunks: [],
      mode: "fallback-disabled-search"
    };
  }

  return {
    docs: [],
    chunks: [],
    mode: "no-match"
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: OLLAMA_MODEL, ollama: OLLAMA_BASE_URL });
});

app.get("/api/status", async (_req, res) => {
  try {
    const [baseline, capabilities, llmRuntime] = await Promise.all([
      callMcpWithFallback("hal_status_baseline", ["get_runtime_status"], {}),
      halMcpClient.callTool("get_capabilities", {}),
      getOllamaRuntime(OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_CONTEXT_WINDOW)
    ]);
    const runtime = baseline?.structuredContent?.data?.runtime || null;
    const products = baselineProductsToUi(runtime);
    const lokiReady = lokiStateFromBaseline(runtime);
    const capabilityCount = Array.isArray(capabilities?.structuredContent?.data?.actions)
      ? capabilities.structuredContent.data.actions.length
      : 0;
    const mcpOk = !baseline?.isError && !capabilities?.isError;

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
            ? `HAL MCP runtime tools ready (${capabilityCount} actions discovered)`
            : "HAL MCP runtime tools unavailable"
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
    const context = resolveBehaviorContextWithIntentHints(prompt);
    const search = await docsForPromptWithFallback(prompt, context);
    res.json({ docs: search.docs, retrieval: { mode: search.mode, debug: search.debug || null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown docs error";
    res.status(500).json({ error: message, docs: [] });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const runtimePolicy = await getRuntimePolicy();

    const prompt = lastUserPrompt(inputMessages);
    const behaviorContext = resolveBehaviorContextWithIntentHints(prompt);
    const behaviorGrounding = await gatherBehaviorGrounding(behaviorContext, halMcpClient).catch(() => null);
    const docSearch = await docsForPromptWithFallback(prompt, behaviorContext).catch(() => ({ docs: [], chunks: [], mode: "error" }));
    const systemPrompt = buildSystemPrompt(
      runtimePolicy,
      [
        buildBehaviorPromptSupplement(behaviorContext),
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

    const deterministicReply = await deterministicIntentResponse(prompt, behaviorContext, behaviorGrounding);
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

app.listen(PORT, HOST, () => {
  console.log(`HAL Plus API running on http://${HOST}:${PORT}`);
});
