import { resolveBehaviorContext } from "./behavior-registry.mjs";
import { mergeBehaviorCommands } from "./behavior-grounding.mjs";

function isOperationalPrompt(prompt) {
  const lower = prompt.toLowerCase();
  const opsWords = [
    "enable",
    "configure",
    "configured",
    "setup",
    "deploy",
    "steps",
    "how",
    "troubleshoot",
    "fix",
    "test",
    "verify",
    "validation",
    "validate",
    "license",
    "workflow",
    "cli",
    "workspace",
    "status",
    "running",
    "up",
    "healthy",
    "health",
    "url",
    "dashboard",
    "grafana",
    "prometheus",
    "reachable"
  ];
  return opsWords.some((w) => lower.includes(w));
}

function isStatusQuestion(prompt) {
  const lower = String(prompt || "").toLowerCase();
  const statusTerms = ["status", "running", "is ", "up", "healthy", "health", "reachable"];
  const productTerms = ["tfe", "terraform", "vault", "consul", "nomad", "boundary", "observability"];
  return statusTerms.some((term) => lower.includes(term)) && productTerms.some((term) => lower.includes(term));
}

function statusRuntimeState(grounding) {
  return String(
    grounding?.status?.data?.runtime?.state ||
      grounding?.component?.data?.runtime?.state ||
      grounding?.component?.data?.state ||
      ""
  )
    .trim()
    .toLowerCase();
}

function isGenericStatusMessage(message) {
  const text = String(message || "").toLowerCase();
  return ["runtime status collected", "status collected", "topic help parsed", "runtime collected"].some((term) =>
    text.includes(term)
  );
}

function statusEvidenceText(grounding) {
  const runtimeState = statusRuntimeState(grounding);
  if (runtimeState === "running") {
    return "HAL MCP runtime reports Terraform Enterprise state: running.";
  }
  if (runtimeState === "not_deployed") {
    return "HAL MCP runtime reports Terraform Enterprise state: not_deployed.";
  }
  if (runtimeState === "partial") {
    return "HAL MCP runtime reports Terraform Enterprise state: partial.";
  }

  const statusMessage = grounding?.status?.message;
  if (statusMessage && !isGenericStatusMessage(statusMessage)) {
    return statusMessage;
  }

  const baselineMessage = grounding?.baseline?.message;
  if (baselineMessage && !isGenericStatusMessage(baselineMessage)) {
    return baselineMessage;
  }

  return (
    grounding?.component?.data?.status ||
    grounding?.component?.data?.state ||
    "HAL MCP returned partial runtime status without a product-specific state line."
  );
}

function statusVerdictFromEvidence(grounding) {
  const runtimeState = statusRuntimeState(grounding);
  if (runtimeState === "running") {
    return { verdict: "Yes", confidence: "high" };
  }
  if (runtimeState === "not_deployed") {
    return { verdict: "No", confidence: "high" };
  }
  if (runtimeState === "partial") {
    return { verdict: "Unknown", confidence: "medium" };
  }

  const text = String([
    grounding?.status?.message || "",
    grounding?.baseline?.message || "",
    grounding?.component?.data?.status || "",
    grounding?.component?.data?.state || ""
  ].join(" ")).toLowerCase();

  if (!text.trim()) {
    return { verdict: "Unknown", confidence: "low" };
  }

  const positiveHints = ["running", "ready", "healthy", "up", "active", "reachable", "online", "deployed"];
  const negativeHints = ["not running", "down", "failed", "error", "unhealthy", "stopped", "unavailable", "not deployed"];

  if (negativeHints.some((term) => text.includes(term))) {
    return { verdict: "No", confidence: "medium" };
  }

  if (positiveHints.some((term) => text.includes(term))) {
    return { verdict: "Yes", confidence: "medium" };
  }

  return { verdict: "Unknown", confidence: "low" };
}

function productCommandHints(prompt, behavior, product) {
  const lowerPrompt = String(prompt || "").toLowerCase();
  const hints = [String(behavior?.product || "").toLowerCase(), String(product?.product || "").toLowerCase()].filter(Boolean);

  if (lowerPrompt.includes("tfe") && !hints.includes("terraform")) {
    hints.push("terraform");
  }
  if (lowerPrompt.includes("observability") && !hints.includes("obs")) {
    hints.push("obs");
  }

  return [...new Set(hints)];
}

function pickPrimaryStatusCommand(prompt, behavior, product, statusCommands, actionCommands) {
  const hints = productCommandHints(prompt, behavior, product);
  const candidates = uniqueStrings([...(statusCommands || []), ...(actionCommands || [])]);
  const scored = candidates
    .filter(Boolean)
    .map((command) => {
      const lower = command.toLowerCase();
      let score = 0;
      if (lower.includes("status")) {
        score += 8;
      }
      if (hints.some((hint) => hint && lower.includes(hint))) {
        score += 10;
      }
      if (lower.includes("capacity")) {
        score -= 8;
      }
      if (lower.startsWith("hal ")) {
        score += 2;
      }
      return { command, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.command || "hal status";
}

function pickVerifyStatusCommand(prompt, behavior, product, verifyCommands, fallbackCommand) {
  const hints = productCommandHints(prompt, behavior, product);
  const candidates = uniqueStrings(verifyCommands || []).filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((command) => {
      const lower = command.toLowerCase();
      let score = 0;
      if (hints.some((hint) => hint && lower.includes(hint))) {
        score += 8;
      }
      if (lower.includes("health_check") || lower.includes("/app") || lower.includes("curl")) {
        score += 6;
      }
      if (fallbackCommand && lower === fallbackCommand.toLowerCase()) {
        score -= 3;
      }
      return { command, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.command || null;
}

function uniqueResourceList(items) {
  const seen = new Set();
  const result = [];

  for (const item of items || []) {
    if (!item?.href || seen.has(item.href)) {
      continue;
    }
    seen.add(item.href);
    result.push(item);
  }

  return result;
}

function describeBaseline(grounding) {
  const statusEnvelope = grounding?.status?.envelope || {};
  const baselineEnvelope = grounding?.baseline?.envelope || {};
  if (String(statusEnvelope.code || "").toLowerCase() === "parse_error" && String(statusEnvelope.message || "").toLowerCase().includes("unknown tool")) {
    return null;
  }
  if (String(baselineEnvelope.code || "").toLowerCase() === "parse_error" && String(baselineEnvelope.message || "").toLowerCase().includes("unknown tool")) {
    return null;
  }
  if (grounding?.status?.message) {
    return grounding.status.message;
  }
  if (grounding?.baseline?.message) {
    return grounding.baseline.message;
  }
  return null;
}

function usageLineFromGrounding(grounding) {
  const usage = grounding?.help?.data?.usage;
  return usage ? `Usage: ${usage}` : null;
}

function uiLinksFromGrounding(grounding) {
  const componentData = grounding?.component?.data || {};
  const links = [];
  if (componentData.endpoint) {
    links.push({ title: "Primary endpoint", href: componentData.endpoint });
  }
  for (const endpoint of componentData.related_endpoints || []) {
    links.push({ title: "Related endpoint", href: endpoint });
  }
  return links;
}

function notesFromGrounding(grounding) {
  const componentData = grounding?.component?.data || {};
  const notes = [];

  if (componentData.license?.environment_variable) {
    notes.push(`Live prerequisite from HAL MCP: set ${componentData.license.environment_variable} before deploy.`);
  }

  if (componentData.browser?.self_signed_certificate) {
    notes.push(`Live browser note from HAL MCP: ${componentData.browser.user_action}.`);
  }

  if (Array.isArray(componentData.seeded_projects) && componentData.seeded_projects.length > 0) {
    notes.push(`HAL MCP reports seeded projects: ${componentData.seeded_projects.join(", ")}.`);
  }

  return notes;
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function includeLinksInAnswer(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return ["url", "endpoint", "link", "ui", "surface", "dashboard", "grafana", "prometheus", "open"].some((term) =>
    lower.includes(term)
  );
}

function compactCommands(commands, limit) {
  return uniqueStrings(commands || []).slice(0, limit);
}

function compactNotes(items, limit) {
  return uniqueStrings(items || []).slice(0, limit);
}

function promptIncludesAny(prompt, terms) {
  const lower = String(prompt || "").toLowerCase();
  return (terms || []).some((term) => lower.includes(String(term || "").toLowerCase()));
}

function scoreResourceForPrompt(prompt, resource) {
  const lowerPrompt = String(prompt || "").toLowerCase();
  const title = String(resource?.title || "").toLowerCase();
  const href = String(resource?.href || "").toLowerCase();
  let score = 0;

  if (resource?.kind === "official") {
    score += 5;
  }

  if (promptIncludesAny(lowerPrompt, ["workspace", "vcs", "gitlab", "pull request", "merge request", "bootstrap"])) {
    if (title.includes("workspace") || href.includes("/workspaces")) {
      score += 6;
    }
    if (title.includes("workflow") || href.includes("workflow")) {
      score += 3;
    }
    if (href.includes("validated-designs") && !title.includes("workspace")) {
      score -= 2;
    }
  }

  const promptWords = lowerPrompt.split(/\W+/).filter(Boolean);
  for (const word of promptWords) {
    if (word.length < 3) {
      continue;
    }
    if (title.includes(word) || href.includes(word)) {
      score += 1;
    }
  }

  return score;
}

export async function deterministicIntentResponse(prompt, preloadedContext, grounding) {
  if (!prompt || !isOperationalPrompt(prompt)) {
    return null;
  }

  const context = preloadedContext || resolveBehaviorContext(prompt);
  const behavior = context.primary || context.product;
  const product = context.product;

  if (!behavior) {
    return null;
  }

  let baselineState = "Unknown";
  const groundedBaseline = describeBaseline(grounding);
  if (groundedBaseline) {
    baselineState = groundedBaseline;
  }
  if (!groundedBaseline) {
    baselineState = "Unknown (HAL MCP runtime baseline unavailable)";
  }

  const usageLine = usageLineFromGrounding(grounding) || "Usage: unavailable (HAL MCP help topic unavailable)";

  const statusCommandsRaw = mergeBehaviorCommands(
    uniqueStrings([...(product?.statusCommands || []), ...(behavior.statusCommands || [])]),
    grounding?.status?.commands || grounding?.baseline?.commands || []
  );
  const actionCommandsRaw = mergeBehaviorCommands(behavior.actionCommands || [], grounding?.plan?.commands || []);
  const verifyCommandsRaw = mergeBehaviorCommands(behavior.verifyCommands || [], grounding?.verify?.commands || []);
  const notesRaw = uniqueStrings([...(behavior.notes || []), ...(product?.notes || []), ...notesFromGrounding(grounding)]);
  const focusBulletsRaw = uniqueStrings([...(behavior.focusBullets || []), ...(product?.focusBullets || [])]);
  const statusCommands = compactCommands(statusCommandsRaw, 2);
  const actionCommands = compactCommands(actionCommandsRaw, 4);
  const verifyCommands = compactCommands(verifyCommandsRaw, 2);
  const notes = compactNotes(notesRaw, 2);
  const focusBullets = compactNotes(focusBulletsRaw, 2);
  const resourceItems = []
    .concat(Array.isArray(behavior.resources) ? behavior.resources : [])
    .concat(Array.isArray(product?.resources) ? product.resources : [])
    .concat((grounding?.status?.docs || []).map((href) => ({ title: "HAL MCP doc", href, kind: "official" })))
    .concat((grounding?.help?.docs || []).map((href) => ({ title: "HAL MCP help doc", href, kind: "official" })))
    .concat((grounding?.verify?.docs || []).map((href) => ({ title: "HAL MCP verify doc", href, kind: "official" })));
  const resources = uniqueResourceList(resourceItems);
  const officialDocs = resources
    .filter((resource) => resource.kind === "official")
    .map((resource) => ({ resource, score: scoreResourceForPrompt(prompt, resource) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.resource)
    .slice(0, 1);
  const uiLinks = uniqueResourceList(
    []
      .concat(Array.isArray(product?.uiLinks) ? product.uiLinks : [])
      .concat(Array.isArray(behavior.uiLinks) ? behavior.uiLinks : [])
      .concat(uiLinksFromGrounding(grounding))
  ).slice(0, 3);

  const shouldIncludeLinks = includeLinksInAnswer(prompt);

  if (isStatusQuestion(prompt)) {
    const verdict = statusVerdictFromEvidence(grounding);
    const evidence = statusEvidenceText(grounding);
    const checkCommand = pickPrimaryStatusCommand(prompt, behavior, product, statusCommands, actionCommands);
    const verifyCommand = pickVerifyStatusCommand(prompt, behavior, product, verifyCommands, checkCommand);

    const statusLines = [
      `Answer: ${verdict.verdict}`,
      `Evidence: ${evidence}`,
      "",
      "Check:",
      "```bash",
      checkCommand,
      "```"
    ];

    if (verifyCommand) {
      statusLines.push("", "Verify:", "```bash", verifyCommand, "```");
    }

    if (verdict.verdict === "Unknown") {
      statusLines.push("", "Note: HAL MCP returned partial status; run the check command above for a fresh product-specific status line.");
    }

    return statusLines.join("\n");
  }

  const lines = [
    `Status: ${baselineState}`,
    "",
    "Run:",
    "```bash",
    ...actionCommands,
    "```"
  ];

  if (grounding?.errors?.length > 0) {
    lines.push("", "Note: MCP runtime status is temporarily unavailable; using the best known deploy path.");
  }

  if (statusCommands.length > 0) {
    lines.push("", "Check:", "```bash", ...statusCommands, "```");
  }

  if (verifyCommands.length > 0) {
    lines.push("", "Verify:", "```bash", ...verifyCommands, "```");
  }

  if (officialDocs.length > 0) {
    lines.push("", `Docs: ${officialDocs[0].href}`);
  }

  if (shouldIncludeLinks && uiLinks.length > 0) {
    lines.push("", "Lab surfaces:", ...uiLinks.map((resource) => `- ${resource.title}: ${resource.href}`));
  }

  const conciseTips = compactNotes([...focusBullets, ...notes], 2);
  if (conciseTips.length > 0) {
    lines.push("", "Tips:", ...conciseTips.map((note) => `- ${note}`));
  }

  if (usageLine && usageLine.includes("Usage:") && usageLine !== "Usage: unavailable (HAL MCP help topic unavailable)") {
    lines.push("", usageLine);
  }

  return lines.join("\n");
}
