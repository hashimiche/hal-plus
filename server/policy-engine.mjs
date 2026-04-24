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
    required_prefetch_tools: ["hal_status_baseline", "get_capabilities", "hal_policy_profile", "validate_command"],
    on_uncertain_then_call: ["validate_command", "get_help_for_topic", "get_skill_for_topic"],
    fallback: {
      mode: "fail_closed",
      allow_answer: false,
      message: "HAL MCP policy unavailable; run hal mcp status and retry."
    }
  },
  recommended_bootstrap: ["hal mcp status", "hal status", "hal --help"],
  source: "local-fallback"
};

function normalizePolicy(input) {
  if (!input || typeof input !== "object") {
    return DEFAULT_POLICY;
  }

  return {
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
}

function jsonObjectSlice(raw) {
  const trimmed = String(raw || "").trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd >= jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }
  return trimmed;
}

export function createPolicyEngine(mcpClient, ttlMs) {
  let policyCache = {
    expiresAt: 0,
    value: DEFAULT_POLICY
  };

  async function getRuntimePolicy() {
    const now = Date.now();
    if (policyCache.expiresAt > now && policyCache.value) {
      return policyCache.value;
    }

    try {
      const toolResult = await mcpClient.callTool("hal_policy_profile", { profile: "strict" });
      const code = String(toolResult?.structuredContent?.code || "").toLowerCase();
      const message = String(toolResult?.structuredContent?.message || "").toLowerCase();
      if (toolResult?.isError && code === "parse_error" && message.includes("unknown tool")) {
        const fallback = normalizePolicy({ ...DEFAULT_POLICY, source: "hal-mcp-fallback" });
        policyCache = { value: fallback, expiresAt: now + ttlMs };
        return fallback;
      }
      const parsed = toolResult?.structuredContent?.data || JSON.parse(jsonObjectSlice(toolResult?.content?.[0]?.text || ""));
      const normalized = normalizePolicy({ ...parsed, source: "hal-mcp-runtime" });
      policyCache = { value: normalized, expiresAt: now + ttlMs };
      return normalized;
    } catch {
      const fallback = normalizePolicy(DEFAULT_POLICY);
      policyCache = { value: fallback, expiresAt: now + ttlMs };
      return fallback;
    }
  }

  function buildSystemPrompt(policy, behaviorPromptSupplement = "") {
    const requiredTools = Array.isArray(policy?.tool_policy?.required_prefetch_tools)
      ? policy.tool_policy.required_prefetch_tools.join(", ")
      : DEFAULT_POLICY.tool_policy.required_prefetch_tools.join(", ");

    const sections = [
      "You are HAL Plus, an educational HashiCorp Academy Labs assistant.",
      "Follow HAL runtime policy as source of truth.",
      `Policy source: ${policy.source || "unknown"}.`,
      `Policy profile: ${policy.profile || "strict"}.`,
      `Policy version: ${policy.policy_version || "unknown"}.`,
      `Contract version: ${policy.contract_version || "unknown"}.`,
      "Always answer in this structure:",
      "1) Status baseline (or explicit unknown)",
      "2) HAL-first command path",
      "3) Official documentation links (real https:// URLs as markdown links only; at most two; omit section if no exact URL is known)",
      "4) Verification commands",
      `Mandatory MCP prefetch tools before operational claims: ${requiredTools}.`,
      "IMPORTANT: Do not fabricate product state, versions, endpoints, or documentation URLs. Only include URLs you are certain of.",
      "If runtime evidence is missing, say unknown and ask for or run checks first.",
      "Use markdown with runnable bash code blocks when relevant."
    ];

    if (behaviorPromptSupplement) {
      sections.push("Relevant local behavior-pack context may be included below and should be treated as grounded lab guidance.");
      sections.push(behaviorPromptSupplement);
    }

    return sections.join("\n\n");
  }

  function lastUserPrompt(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role === "user" && typeof msg?.content === "string") {
        return msg.content.trim();
      }
    }
    return "";
  }

  return {
    getRuntimePolicy,
    buildSystemPrompt,
    lastUserPrompt
  };
}
