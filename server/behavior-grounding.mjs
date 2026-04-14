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

async function callToolWithFallback(mcpClient, primaryTool, fallbackTools, args = {}) {
  const primary = await mcpClient.callTool(primaryTool, args);
  const code = String(primary?.structuredContent?.code || "").toLowerCase();
  const message = String(primary?.structuredContent?.message || "").toLowerCase();
  if (!primary?.isError || !(code === "parse_error" && message.includes("unknown tool"))) {
    return primary;
  }

  for (const fallbackTool of fallbackTools || []) {
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

  return lines.join("\n");
}

export async function gatherBehaviorGrounding(context, mcpClient) {
  const config = behaviorMcpConfig(context);
  if (!config || !mcpClient) {
    return null;
  }

  const calls = [];

  if (config.baselineTool) {
    calls.push(callToolWithFallback(mcpClient, config.baselineTool, ["get_runtime_status"], {}).then((value) => ["baseline", value]));
  }
  if (config.statusTool) {
    calls.push(mcpClient.callTool(config.statusTool, {}).then((value) => ["status", value]));
  }
  if (config.helpTopic) {
    calls.push(mcpClient.callTool("get_help_for_topic", { topic: config.helpTopic }).then((value) => ["help", value]));
  }
  if (config.component) {
    calls.push(mcpClient.callTool("get_component_context", { component: config.component }).then((value) => ["component", value]));
  }
  if (config.verifyComponent) {
    calls.push(mcpClient.callTool("hal_plan_verify", { component: config.verifyComponent }).then((value) => ["verify", value]));
  }
  if (config.planIntent) {
    calls.push(callToolWithFallback(mcpClient, "hal_plan_deploy", ["plan_next_steps"], { intent: config.planIntent }).then((value) => ["plan", value]));
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

export function mergeBehaviorCommands(behaviorCommands, groundingCommands) {
  return uniqueStrings([...(groundingCommands || []), ...(behaviorCommands || [])]);
}
