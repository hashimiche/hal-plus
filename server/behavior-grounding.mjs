function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normalizeEnvelope(raw) {
  const envelope = raw?.structuredContent;
  if (!envelope || typeof envelope !== "object") {
    return null;
  }

  return envelope;
}

function getRecommendedCommands(envelope) {
  return Array.isArray(envelope?.recommended_commands) ? envelope.recommended_commands.filter(Boolean) : [];
}

function getDocs(envelope) {
  return Array.isArray(envelope?.docs) ? envelope.docs.filter(Boolean) : [];
}

function getData(envelope) {
  return envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
}

function behaviorMcpConfig(context) {
  const behavior = context?.primary || context?.product;
  const product = context?.product;
  if (!behavior) {
    return null;
  }

  return {
    ...(product?.mcp || {}),
    ...(behavior?.mcp || {})
  };
}

function runtimeToolNames(runtimeCatalog) {
  return new Set(Array.isArray(runtimeCatalog?.toolNames) ? runtimeCatalog.toolNames : []);
}

function pickAvailableTool(runtimeCatalog, primaryTool, fallbackTools = []) {
  if (!runtimeCatalog) {
    return null;
  }

  const available = runtimeToolNames(runtimeCatalog);
  if (primaryTool && available.has(primaryTool)) {
    return primaryTool;
  }

  for (const fallbackTool of fallbackTools) {
    if (fallbackTool && available.has(fallbackTool)) {
      return fallbackTool;
    }
  }

  return null;
}

function coverageEntry(primaryTool, selectedTool, required) {
  return {
    primaryTool,
    required,
    status: selectedTool ? (selectedTool === primaryTool ? "available" : "fallback") : "missing"
  };
}

export function evaluateBehaviorMcpCoverage(context, runtimeCatalog, runtimePolicy = null) {
  const config = behaviorMcpConfig(context);
  const capabilities = runtimeCatalog?.capabilities && typeof runtimeCatalog.capabilities === "object" ? runtimeCatalog.capabilities : {};
  const skills = capabilities?.skills && typeof capabilities.skills === "object" ? capabilities.skills : runtimeCatalog?.skills || {};
  const required = [];
  const optional = [];

  const addRequirement = (primaryTool, fallbackTools, isRequired) => {
    if (!primaryTool) {
      return;
    }
    const entry = coverageEntry(primaryTool, pickAvailableTool(runtimeCatalog, primaryTool, fallbackTools), isRequired);
    if (isRequired) {
      required.push(entry);
      return;
    }
    optional.push(entry);
  };

  const requiredPrefetch = Array.isArray(runtimePolicy?.tool_policy?.required_prefetch_tools)
    ? runtimePolicy.tool_policy.required_prefetch_tools
    : [];
  for (const toolName of requiredPrefetch) {
    addRequirement(toolName, [], true);
  }

  if (config) {
    addRequirement(config.baselineTool, ["get_runtime_status"], true);
    addRequirement(config.statusTool, [], false);
    addRequirement(config.helpTopic ? "get_help_for_topic" : null, [], false);
    addRequirement(config.component ? "get_component_context" : null, [], false);
    addRequirement(config.verifyComponent ? "hal_plan_verify" : null, [], false);
    addRequirement(config.planIntent ? "hal_plan_deploy" : null, ["plan_next_steps"], false);
    addRequirement(config.helpTopic || config.component ? "get_skill_for_topic" : null, [], false);
  }

  const missingRequired = required.filter((entry) => entry.status === "missing");
  const missingOptional = optional.filter((entry) => entry.status === "missing");

  return {
    discoveryAvailable: Boolean(runtimeCatalog),
    toolCount: runtimeToolNames(runtimeCatalog).size,
    actionCount: Array.isArray(capabilities?.actions) ? capabilities.actions.length : Array.isArray(runtimeCatalog?.actions) ? runtimeCatalog.actions.length : 0,
    skillsCount: Number(skills?.skills_count || 0),
    missingRequired,
    missingOptional,
    hasMissingRequired: missingRequired.length > 0,
    hasMissingOptional: missingOptional.length > 0
  };
}

async function callToolWithFallback(mcpClient, runtimeCatalog, primaryTool, fallbackTools, args = {}) {
  const selectedTool = pickAvailableTool(runtimeCatalog, primaryTool, fallbackTools);
  if (!selectedTool) {
    return null;
  }

  const primary = await mcpClient.callTool(selectedTool, args);
  const code = String(primary?.structuredContent?.code || "").toLowerCase();
  const message = String(primary?.structuredContent?.message || "").toLowerCase();
  if (!primary?.isError || !(code === "parse_error" && message.includes("unknown tool"))) {
    return primary;
  }

  for (const fallbackTool of fallbackTools || []) {
    if (fallbackTool === selectedTool) {
      continue;
    }
    if (runtimeCatalog && !runtimeToolNames(runtimeCatalog).has(fallbackTool)) {
      continue;
    }
    const fallback = await mcpClient.callTool(fallbackTool, args);
    if (!fallback?.isError) {
      return fallback;
    }
  }

  return primary;
}

function summarizeGrounding(grounding) {
  if (!grounding) {
    return "";
  }

  const lines = ["HAL MCP verified runtime context:"];

  if (grounding.status?.message) {
    lines.push(`- Status: ${grounding.status.message}`);
  }

  const componentData = grounding.component?.data || {};
  if (componentData.endpoint) {
    lines.push(`- Endpoint: ${componentData.endpoint}`);
  }

  if (Array.isArray(componentData.related_endpoints) && componentData.related_endpoints.length > 0) {
    lines.push(`- Related endpoints: ${componentData.related_endpoints.join(", ")}`);
  }

  if (componentData.license?.environment_variable) {
    lines.push(`- License env var: ${componentData.license.environment_variable}`);
  }

  if (grounding.help?.data?.usage) {
    lines.push(`- Usage: ${grounding.help.data.usage}`);
  }

  if (grounding.plan?.commands?.length > 0) {
    lines.push(`- Planned commands: ${grounding.plan.commands.join(", ")}`);
  }

  if (grounding.verify?.commands?.length > 0) {
    lines.push(`- Verification commands: ${grounding.verify.commands.join(", ")}`);
  }

  const skills = grounding.skill?.data?.skills;
  if (Array.isArray(skills) && skills.length > 0) {
    lines.push("");
    lines.push("HAL embedded skill guidance (authoritative):");
    for (const s of skills) {
      if (s.content) {
        lines.push(`\n--- skill: ${s.path} ---`);
        lines.push(s.content.trim());
      }
    }
  }

  return lines.join("\n");
}

export async function gatherBehaviorGrounding(context, mcpClient, runtimeCatalog = null, userPrompt = "") {
  const config = behaviorMcpConfig(context);
  if (!config || !mcpClient) {
    return null;
  }

  const calls = [];

  if (config.baselineTool) {
    const selectedTool = pickAvailableTool(runtimeCatalog, config.baselineTool, ["get_runtime_status"]);
    if (selectedTool) {
      calls.push(callToolWithFallback(mcpClient, runtimeCatalog, config.baselineTool, ["get_runtime_status"], {}).then((value) => ["baseline", value]));
    }
  }
  if (config.statusTool) {
    const selectedTool = pickAvailableTool(runtimeCatalog, config.statusTool, []);
    if (selectedTool) {
      calls.push(mcpClient.callTool(selectedTool, {}).then((value) => ["status", value]));
    }
  }
  if (config.helpTopic) {
    const selectedTool = pickAvailableTool(runtimeCatalog, "get_help_for_topic", []);
    if (selectedTool) {
      calls.push(mcpClient.callTool(selectedTool, { topic: config.helpTopic }).then((value) => ["help", value]));
    }
  }
  if (config.component) {
    const selectedTool = pickAvailableTool(runtimeCatalog, "get_component_context", []);
    if (selectedTool) {
      calls.push(mcpClient.callTool(selectedTool, { component: config.component }).then((value) => ["component", value]));
    }
  }
  if (config.verifyComponent) {
    const selectedTool = pickAvailableTool(runtimeCatalog, "hal_plan_verify", []);
    if (selectedTool) {
      calls.push(mcpClient.callTool(selectedTool, { component: config.verifyComponent }).then((value) => ["verify", value]));
    }
  }
  const resolvedIntent = config.planIntent || String(userPrompt || "").trim() || "";
  if (resolvedIntent) {
    const selectedTool = pickAvailableTool(runtimeCatalog, "hal_plan_deploy", ["plan_next_steps"]);
    if (selectedTool) {
      calls.push(callToolWithFallback(mcpClient, runtimeCatalog, "hal_plan_deploy", ["plan_next_steps"], { intent: resolvedIntent }).then((value) => ["plan", value]));
    }
  }

  const skillTopic = config.helpTopic || config.component || null;
  if (skillTopic) {
    const selectedTool = pickAvailableTool(runtimeCatalog, "get_skill_for_topic", []);
    if (selectedTool) {
      calls.push(mcpClient.callTool(selectedTool, { topic: skillTopic }).then((value) => ["skill", value]));
    }
  }

  if (calls.length === 0) {
    return null;
  }

  const settled = await Promise.allSettled(calls);
  const grounding = { raw: {}, errors: [] };

  for (const result of settled) {
    if (result.status === "rejected") {
      grounding.errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue;
    }

    const [key, value] = result.value;
    const envelope = normalizeEnvelope(value);
    grounding.raw[key] = value;
    if (!envelope) {
      continue;
    }

    grounding[key] = {
      envelope,
      message: envelope.message || "",
      data: getData(envelope),
      commands: getRecommendedCommands(envelope),
      docs: getDocs(envelope),
      checks: Array.isArray(envelope.checks) ? envelope.checks : []
    };
  }

  return grounding;
}

export function buildGroundingPromptSupplement(grounding) {
  return summarizeGrounding(grounding);
}

export function buildMcpCoveragePromptSupplement(coverage) {
  if (!coverage) {
    return "";
  }

  const lines = [`HAL MCP discovery: ${coverage.toolCount} tools, ${coverage.actionCount} actions, ${coverage.skillsCount} embedded skills.`];

  if (coverage.hasMissingRequired) {
    lines.push(`Missing required MCP tools: ${coverage.missingRequired.map((entry) => entry.primaryTool).join(", ")}.`);
  }

  if (coverage.hasMissingOptional) {
    lines.push(
      `Missing optional MCP grounding tools for this prompt: ${coverage.missingOptional.map((entry) => entry.primaryTool).join(", ")}.`
    );
  }

  return lines.join("\n");
}

export function mergeBehaviorCommands(behaviorCommands, groundingCommands) {
  // Behavior file commands are curated for this exact intent and take priority.
  // Grounding commands from MCP supplement with anything not already present.
  return uniqueStrings([...(behaviorCommands || []), ...(groundingCommands || [])]);
}
