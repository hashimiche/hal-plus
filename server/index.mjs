import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.API_PORT || 9001);
const HOST = process.env.API_HOST || "127.0.0.1";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4";
const OLLAMA_CONTEXT_WINDOW = Number(process.env.OLLAMA_CONTEXT_WINDOW || 32768);
const execFileAsync = promisify(execFile);
const POLICY_CACHE_TTL_MS = Number(process.env.HAL_POLICY_CACHE_TTL_MS || 30000);
const DEFAULT_POLICY = {
  policy_version: "fallback-1",
  contract_version: "fallback-1",
  profile: "strict",
  answer_policy: {
    mode: "hal_first",
    disallow_unverified_claims: true,
    disallow_non_hal_primary_paths: true,
    include_verification_commands: true,
    include_official_docs: true
  },
  tool_policy: {
    required_prefetch_tools: ["hal_status_baseline", "get_capabilities", "validate_command"],
    on_uncertain_then_call: ["validate_command", "get_help_for_topic"],
    fallback: {
      mode: "fail_closed",
      allow_answer: false,
      message: "HAL MCP policy unavailable; run hal mcp status and retry."
    }
  },
  recommended_bootstrap: ["hal mcp status", "hal status", "hal --help"],
  source: "local-fallback"
};

let policyCache = {
  expiresAt: 0,
  value: DEFAULT_POLICY
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: OLLAMA_MODEL, ollama: OLLAMA_BASE_URL });
});

async function runHal(args) {
  const { stdout, stderr } = await execFileAsync("hal", args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
  return `${stdout || ""}${stderr || ""}`;
}

function normalizePolicy(input) {
  if (!input || typeof input !== "object") {
    return DEFAULT_POLICY;
  }

  const merged = {
    ...DEFAULT_POLICY,
    ...input,
    answer_policy: {
      ...DEFAULT_POLICY.answer_policy,
      ...(input.answer_policy || {})
    },
    tool_policy: {
      ...DEFAULT_POLICY.tool_policy,
      ...(input.tool_policy || {}),
      fallback: {
        ...DEFAULT_POLICY.tool_policy.fallback,
        ...((input.tool_policy && input.tool_policy.fallback) || {})
      }
    }
  };

  return merged;
}

async function getRuntimePolicy() {
  const now = Date.now();
  if (policyCache.expiresAt > now && policyCache.value) {
    return policyCache.value;
  }

  try {
    const raw = await runHal(["mcp", "policy", "--json", "--profile", "strict"]);
    const trimmed = raw.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    const jsonSlice = jsonStart >= 0 && jsonEnd >= jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;
    const parsed = JSON.parse(jsonSlice);
    const normalized = normalizePolicy({ ...parsed, source: "hal-mcp-runtime" });
    policyCache = { value: normalized, expiresAt: now + POLICY_CACHE_TTL_MS };
    return normalized;
  } catch {
    const fallback = normalizePolicy(DEFAULT_POLICY);
    policyCache = { value: fallback, expiresAt: now + POLICY_CACHE_TTL_MS };
    return fallback;
  }
}

function buildSystemPrompt(policy) {
  const requiredTools = Array.isArray(policy?.tool_policy?.required_prefetch_tools)
    ? policy.tool_policy.required_prefetch_tools.join(", ")
    : "hal_status_baseline, get_capabilities, validate_command";

  return [
    "You are HAL Plus, an educational HashiCorp Academy Labs assistant.",
    "Follow HAL runtime policy as source of truth.",
    `Policy source: ${policy.source || "unknown"}.`,
    `Policy profile: ${policy.profile || "strict"}.`,
    `Policy version: ${policy.policy_version || "unknown"}.`,
    `Contract version: ${policy.contract_version || "unknown"}.`,
    "Always answer in this structure:",
    "1) Status baseline (or explicit unknown)",
    "2) HAL-first command path",
    "3) Official documentation links",
    "4) Verification commands",
    `Mandatory MCP prefetch tools before operational claims: ${requiredTools}.`,
    "Do not fabricate product state, versions, or endpoints.",
    "If runtime evidence is missing, say unknown and ask for or run checks first.",
    "Use markdown with runnable bash code blocks when relevant."
  ].join(" ");
}

function parseHalStatus(raw) {
  const lines = raw.split("\n");
  const products = [];
  let current = null;

  const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "");

  for (const line of lines) {
    const cleanLine = stripAnsi(line).trimEnd();
    const lineNoIcon = cleanLine.replace(/^[🟢⚪🟡]\s+/, "");

    let stateRaw = "";
    let stateIdx = lineNoIcon.indexOf("Running");
    if (stateIdx >= 0) {
      stateRaw = "Running";
    } else {
      stateIdx = lineNoIcon.indexOf("Not Deployed");
      if (stateIdx >= 0) {
        stateRaw = "Not Deployed";
      }
    }

    if (stateIdx >= 0) {
      const name = lineNoIcon.slice(0, stateIdx).trim().replace(/^[^A-Za-z0-9]+/, "");
      const tail = lineNoIcon.slice(stateIdx + stateRaw.length).trim();
      const tailCols = tail.split(/\s{2,}/).map((v) => v.trim()).filter(Boolean);
      const endpointRaw = tailCols[0] || "-";
      const versionRaw = tailCols[1] || "-";

      current = {
        name,
        state: stateRaw === "Running" ? "running" : "not-deployed",
        endpoint: endpointRaw,
        version: versionRaw,
        features: []
      };
      products.push(current);
      continue;
    }

    const featureMatch = cleanLine.match(/↳\s+([A-Za-z0-9_-]+)\s+(.+)$/);
    if (featureMatch && current) {
      const [, key, value] = featureMatch;
      current.features.push(`${key.trim()}:${value.trim()}`);
    }
  }

  return products;
}

async function getOllamaRuntime() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      return { ok: false, detail: `${OLLAMA_BASE_URL} · not reachable` };
    }
    const data = await response.json();
    const hasModel = Array.isArray(data?.models)
      ? data.models.some((m) => typeof m?.name === "string" && m.name.startsWith(OLLAMA_MODEL))
      : false;
    return {
      ok: hasModel,
      model: OLLAMA_MODEL,
      contextWindow: OLLAMA_CONTEXT_WINDOW,
      detail: hasModel
        ? `${OLLAMA_BASE_URL} · model ${OLLAMA_MODEL} ready`
        : `${OLLAMA_BASE_URL} · model ${OLLAMA_MODEL} missing`
    };
  } catch {
    return {
      ok: false,
      model: OLLAMA_MODEL,
      contextWindow: OLLAMA_CONTEXT_WINDOW,
      detail: `${OLLAMA_BASE_URL} · not reachable`
    };
  }
}

app.get("/api/status", async (_req, res) => {
  try {
    const [halStatusRaw, halMcpRaw, llmRuntime] = await Promise.all([
      runHal(["status"]),
      runHal(["mcp", "status"]),
      getOllamaRuntime()
    ]);

    const products = parseHalStatus(halStatusRaw);
    const obs = products.find((p) => p.name.toLowerCase() === "observability");
    const lokiReady = !!obs && obs.features.some((f) => f.startsWith("loki:enabled"));

    const mcpOk = halMcpRaw.includes("Config file:  ✅ Present") && halMcpRaw.includes("Managed bin:  ✅ Present");

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
          detail: mcpOk ? "hal mcp status · config and managed binary present" : "hal mcp status · setup incomplete"
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

app.post("/api/chat", async (req, res) => {
  try {
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const runtimePolicy = await getRuntimePolicy();
    const systemPrompt = buildSystemPrompt(runtimePolicy);

    const messages = [
      { role: "system", content: systemPrompt },
      ...inputMessages
        .filter((m) => typeof m?.role === "string" && typeof m?.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    ];

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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = ollamaResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const chunk = parsed?.message?.content || "";
        if (chunk) {
          res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
        }

        if (parsed?.done) {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          return;
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, HOST, () => {
  console.log(`HAL Plus API running on http://${HOST}:${PORT}`);
});
