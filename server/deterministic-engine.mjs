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
    "url",
    "dashboard",
    "grafana",
    "prometheus",
    "reachable"
  ];
  return opsWords.some((w) => lower.includes(w));
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
  const notesRaw = uniqueStrings([...(product?.notes || []), ...(behavior.notes || []), ...notesFromGrounding(grounding)]);
  const focusBulletsRaw = uniqueStrings([...(product?.focusBullets || []), ...(behavior.focusBullets || [])]);
  const statusCommands = compactCommands(statusCommandsRaw, 2);
  const actionCommands = compactCommands(actionCommandsRaw, 4);
  const verifyCommands = compactCommands(verifyCommandsRaw, 2);
  const notes = compactNotes(notesRaw, 2);
  const focusBullets = compactNotes(focusBulletsRaw, 2);
  const resourceItems = []
    .concat(Array.isArray(product?.resources) ? product.resources : [])
    .concat(Array.isArray(behavior.resources) ? behavior.resources : [])
    .concat((grounding?.status?.docs || []).map((href) => ({ title: "HAL MCP doc", href, kind: "official" })))
    .concat((grounding?.help?.docs || []).map((href) => ({ title: "HAL MCP help doc", href, kind: "official" })))
    .concat((grounding?.verify?.docs || []).map((href) => ({ title: "HAL MCP verify doc", href, kind: "official" })));
  const resources = uniqueResourceList(resourceItems);
  const officialDocs = resources.filter((resource) => resource.kind === "official").slice(0, 1);
  const uiLinks = uniqueResourceList(
    []
      .concat(Array.isArray(product?.uiLinks) ? product.uiLinks : [])
      .concat(Array.isArray(behavior.uiLinks) ? behavior.uiLinks : [])
      .concat(uiLinksFromGrounding(grounding))
  ).slice(0, 3);

  const shouldIncludeLinks = includeLinksInAnswer(prompt);

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
