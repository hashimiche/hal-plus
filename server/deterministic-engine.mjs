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
    "create",
    "start",
    "build",
    "bring up",
    "spin up",
    "set up",
    "steps",
    "how",
    "what",
    "check",
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
    "metrics",
    "monitor",
    "monitoring",
    "observability",
    "audit",
    "wire",
    "wiring",
    "reachable"
  ];
  return opsWords.some((w) => lower.includes(w));
}

export function isStatusQuestion(prompt) {
  const lower = String(prompt || "").toLowerCase();
  const statusTerms = ["status", "running", "is ", "up", "healthy", "health", "reachable"];
  const productTerms = ["tfe", "terraform", "vault", "consul", "nomad", "boundary", "observability"];
  return statusTerms.some((term) => lower.includes(term)) && productTerms.some((term) => lower.includes(term));
}

// Route A — knowledge/factual intent: user is asking a conceptual or prerequisite question.
// These must NOT produce a command dump. See llm/ANSWER_QUALITY.md Route A.
function isKnowledgeQuestion(prompt) {
  const lower = String(prompt || "").toLowerCase();
  const knowledgePhrases = [
    "does ",
    "do i need",
    "is it required",
    "is it free",
    "is it enterprise",
    "is it ent",
    "needs a license",
    "need a license",
    "require a license",
    "what is ",
    "what's the difference",
    "why does",
    "difference between",
    "what does it need",
    // URL / access questions
    "what url",
    "what urls",
    "which url",
    "which urls",
    "what endpoint",
    "what address",
    "where is the",
    "where can i",
    "where do i go",
    "what port",
    "what ports",
    "how do i access",
    "how do i open",
    "how do i reach",
    // Aspirational / conceptual intent
    "i want to understand",
    "i want to know",
    "i want to learn",
    "tell me about",
    "explain "
  ];
  // Operational signals override the knowledge classification.
  const operationalOverride = [
    "configure",
    "how to",
    "give me the code",
    "show me",
    "steps to",
    "enable",
    "deploy",
    "install"
  ];
  const matchesKnowledge = knowledgePhrases.some((p) => lower.includes(p));
  const matchesOperational = operationalOverride.some((p) => lower.includes(p));
  return matchesKnowledge && !matchesOperational;
}

// Route C — follow-up / contextual prompt detection.
// Short prompts with no clear topic are likely follow-ups to the previous exchange.
// See llm/ANSWER_QUALITY.md Route C.
export function isFollowUpPrompt(prompt) {
  const lower = String(prompt || "").trim().toLowerCase();
  if (lower.length > 80) {
    return false;
  }
  // Phrases that must appear at the START of the prompt to count as follow-up starters.
  const startFollowUps = [
    "and ", "what about", "how about", "on a ", "same for", "what if",
    "can i ", "could i ", "is it possible", "also ", "and if", "but if",
    "another ", "different ", "or ", "instead of", "without ", "with a "
  ];
  // Phrases that count anywhere in a short prompt.
  const anywhereFollowUps = [
    "what about", "how about", "same for"
  ];
  return startFollowUps.some((p) => lower.startsWith(p)) ||
    anywhereFollowUps.some((p) => lower.includes(p));
}

// Route B code-intent sub-flag: user wants to see internals / raw commands / config code.
// When true, the model supplement cap is lifted and behavior body is surfaced.
// See llm/ANSWER_QUALITY.md Route B code-intent expansion.
export function isCodeIntent(prompt) {
  const lower = String(prompt || "").toLowerCase();
  const directPhrases = [
    "give me the code",
    "show me the code",
    "show me the config",
    "the code",
    "what's the api",
    "api call",
    "curl command",
    "raw command",
    "how does it work",
    "under the hood",
    "what does hal do",
    "internals",
    "what happens",
    "cli command"
  ];
  if (directPhrases.some((p) => lower.includes(p))) {
    return true;
  }
  // "configure the X" or "X configuration" paired with code/example signal.
  const configSignal = lower.includes("configure") || lower.includes("configuration");
  const codeSignal = ["code", "snippet", "block", "example", "how"].some((p) => lower.includes(p));
  return configSignal && codeSignal;
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

function hasEngineUnavailableSignal(grounding) {
  const text = String([
    grounding?.status?.message || "",
    grounding?.baseline?.message || "",
    grounding?.component?.data?.status || "",
    grounding?.component?.data?.state || ""
  ].join(" ")).toLowerCase();

  return text.includes("no container engine found");
}

function probeStateForContext(probeProducts, context) {
  const productName = String(
    context?.primary?.id || context?.product?.id || context?.primary?.label || context?.product?.label || ""
  ).toLowerCase();
  if (!productName || !Array.isArray(probeProducts)) return null;

  const probe = probeProducts.find((p) => {
    const n = String(p?.name || "").toLowerCase();
    return n === productName || n.includes(productName) || productName.includes(n);
  });
  return probe || null;
}

function statusEvidenceText(grounding, probeProducts = [], context = null) {
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

  if (hasEngineUnavailableSignal(grounding)) {
    const probe = probeStateForContext(probeProducts, context);
    if (probe) {
      const stateLabel = probe.state === "running" ? "reachable" : probe.state === "not-deployed" ? "not reachable" : "state unknown";
      return `Probe: ${probe.name} endpoint is ${stateLabel}. Run \`hal ${String(probe.name).toLowerCase()} status\` for full details (version, health, features).`;
    }
    return "MCP baseline could not query container runtime; run the product status command for authoritative state.";
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

function statusVerdictFromEvidence(grounding, probeProducts = [], context = null) {
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

  if (hasEngineUnavailableSignal(grounding)) {
    const probe = probeStateForContext(probeProducts, context);
    if (probe?.state === "running") return { verdict: "Yes", confidence: "medium" };
    if (probe?.state === "not-deployed") return { verdict: "No", confidence: "medium" };
    return { verdict: "Unknown", confidence: "low" };
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
  return [
    "url",
    "endpoint",
    "link",
    "ui",
    "surface",
    "dashboard",
    "grafana",
    "prometheus",
    "loki",
    "monitor",
    "monitoring",
    "observability",
    "open"
  ].some((term) => lower.includes(term));
}

function isMonitoringIntent(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return ["monitor", "monitoring", "observability", "grafana", "prometheus", "loki", "dashboard"].some((term) =>
    lower.includes(term)
  );
}

function isMonitoringResource(resource) {
  const title = String(resource?.title || "").toLowerCase();
  const href = String(resource?.href || "").toLowerCase();
  return ["monitor", "observability", "grafana", "prometheus", "loki", "dashboard"].some(
    (term) => title.includes(term) || href.includes(term)
  );
}

function compactCommands(commands, limit) {
  return uniqueStrings(commands || []).slice(0, limit);
}

function compactNotes(items, limit) {
  return uniqueStrings(items || []).slice(0, limit);
}

function coverageNotes(coverage) {
  if (!coverage) {
    return [];
  }

  const notes = [];
  if (!coverage.discoveryAvailable) {
    notes.push("HAL MCP tool discovery is unavailable for this prompt, so live grounding is partial.");
    return notes;
  }
  if (coverage.hasMissingRequired) {
    notes.push(`HAL MCP is missing required tools for this flow: ${coverage.missingRequired.map((entry) => entry.primaryTool).join(", ")}.`);
  }
  if (coverage.hasMissingOptional) {
    notes.push(`HAL MCP is missing optional grounding tools for this flow: ${coverage.missingOptional.map((entry) => entry.primaryTool).join(", ")}.`);
  }
  return notes;
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
  const isDatabaseDoc =
    title.includes("database") || href.includes("db-credentials") || href.includes("/secrets/databases") || href.includes("/database");
  const databaseIntent = promptIncludesAny(lowerPrompt, [
    "database",
    "db",
    "credentials",
    "dynamic credentials",
    "rotate root",
    "jit"
  ]);
  const monitoringIntent = promptIncludesAny(lowerPrompt, [
    "monitor",
    "monitoring",
    "observability",
    "grafana",
    "prometheus",
    "loki",
    "dashboard"
  ]);

  if (resource?.kind === "official") {
    score += 5;
  }

  if (isDatabaseDoc && !databaseIntent) {
    score -= 8;
  }

  if (monitoringIntent) {
    if (title.includes("observability") || title.includes("monitor") || href.includes("observability") || href.includes("monitor")) {
      score += 6;
    }
    if (isDatabaseDoc) {
      score -= 6;
    }
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

// Detect URL-first intent: user is asking for endpoints, ports, surfaces.
function isUrlIntent(prompt) {
  const lower = String(prompt || "").toLowerCase();
  return ["url", "endpoint", "port", "address", "where is", "where can i", "how do i access", "how do i open", "how do i reach", "lab surface"].some((p) => lower.includes(p));
}

// Build a Route A knowledge answer: prose + one command + one doc.
// For URL-intent prompts, leads with lab surfaces instead of prose.
// No Preflight/Run/Check/Verify blocks. See llm/ANSWER_QUALITY.md.
function buildKnowledgeAnswer(prompt, behavior, product, grounding, docSearch) {
  const summary = behavior.summary || product?.summary || "";
  const lowerPrompt = String(prompt || "").toLowerCase();

  // Collect UI links for URL-first answers.
  const uiLinks = uniqueResourceList(
    []
      .concat(Array.isArray(product?.uiLinks) ? product.uiLinks : [])
      .concat(Array.isArray(behavior.uiLinks) ? behavior.uiLinks : [])
      .concat(uiLinksFromGrounding(grounding))
  );

  // For URL-intent prompts, lead with the surfaces and skip the prose dump.
  if (isUrlIntent(prompt) && uiLinks.length > 0) {
    const lines = ["Lab surfaces:", ""];
    for (const link of uiLinks) {
      lines.push(`- **${link.title}**: ${link.href}`);
    }
    const docFromBehavior = (behavior.resources || []).find((r) => r.kind === "official");
    if (docFromBehavior) {
      lines.push("", `Docs: ${docFromBehavior.href}`);
    }
    return lines.join("\n");
  }

  // Pick the most prompt-relevant note or bullet to append to the summary.
  const allBullets = uniqueStrings([
    ...(behavior.focusBullets || []),
    ...(product?.focusBullets || []),
    ...(behavior.notes || []),
    ...(product?.notes || []),
    ...notesFromGrounding(grounding)
  ]);
  const scoredBullets = allBullets
    .map((bullet) => {
      const lower = bullet.toLowerCase();
      let score = 0;
      for (const word of lowerPrompt.split(/\W+/).filter((w) => w.length > 3)) {
        if (lower.includes(word)) score += 1;
      }
      if (lowerPrompt.includes("license") && (lower.includes("license") || lower.includes("_license"))) score += 5;
      if ((lowerPrompt.includes("enterprise") || lowerPrompt.includes(" ent")) && lower.includes("enterprise")) score += 4;
      if (lowerPrompt.includes("csi") && lower.includes("csi")) score += 4;
      if (lowerPrompt.includes("cli") && lower.includes("cli")) score += 3;
      return { bullet, score };
    })
    .sort((a, b) => b.score - a.score);
  const relevantBullet = scoredBullets[0]?.score > 0 ? scoredBullets[0].bullet : null;

  // Build prose: summary sentence + most relevant note.
  const proseParts = [summary];
  if (relevantBullet && relevantBullet !== summary) {
    proseParts.push(relevantBullet);
  }
  const prose = proseParts.join(" ");

  // One key command: first actionCommand that looks like a license export or primary create.
  const licenseExport = (behavior.actionCommands || []).find((c) => c.toLowerCase().includes("export"));
  const keyCommand = licenseExport || (behavior.actionCommands || [])[0] || null;

  // One doc: prefer docSearch result, then first official resource.
  const docFromSearch = Array.isArray(docSearch?.docs) && docSearch.docs[0]?.href ? docSearch.docs[0] : null;
  const docFromBehavior = (behavior.resources || []).find((r) => r.kind === "official");
  const doc = docFromSearch || docFromBehavior || null;

  const lines = [prose, ""];
  if (keyCommand) {
    lines.push("```bash", keyCommand, "```", "");
  }
  if (doc) {
    lines.push(`Docs: ${doc.href}`);
  }
  return lines.join("\n");
}

export async function deterministicIntentResponse(prompt, preloadedContext, grounding, coverage = null, docSearch = null, probeProducts = []) {
  if (!prompt || !isOperationalPrompt(prompt)) {
    return null;
  }

  const context = preloadedContext || resolveBehaviorContext(prompt);
  const behavior = context.primary || context.product;
  const product = context.product;

  if (!behavior) {
    return null;
  }

  // Route A — knowledge/factual questions get prose, not a command dump.
  if (isKnowledgeQuestion(prompt)) {
    return buildKnowledgeAnswer(prompt, behavior, product, grounding, docSearch);
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
  // Filter grounding plan commands to only those that belong to the matched product/subcommand,
  // preventing cross-product command pollution (e.g. obs commands leaking into a vault k8s intent).
  const productHints = uniqueStrings([
    behavior.product,
    behavior.subcommand && behavior.subcommand !== "product" ? behavior.subcommand : null,
    product?.product
  ]).map((s) => String(s || "").toLowerCase()).filter(Boolean);
  // For subcommand-specific behaviors (e.g. vault k8s), grounding action commands must match the
  // subcommand name to prevent sibling-subcommand pollution (e.g. "hal vault audit" or "hal obs status"
  // appearing in a k8s flow Run section). Status commands belong only in Check, not Run.
  // For product-level behaviors use the broader product hints.
  const actionCommandHints =
    behavior.subcommand && behavior.subcommand !== "product"
      ? [behavior.subcommand]
      : productHints;
  const planCommandsFiltered = (grounding?.plan?.commands || []).filter((cmd) => {
    if (!actionCommandHints.length) return true;
    const lower = String(cmd || "").toLowerCase();
    return actionCommandHints.some((hint) => lower.includes(hint));
  });
  const skillCommandsFiltered = (grounding?.skill?.commands || []).filter((cmd) => {
    if (!actionCommandHints.length) return true;
    const lower = String(cmd || "").toLowerCase();
    return actionCommandHints.some((hint) => lower.includes(hint));
  });
  const actionCommandsRaw = mergeBehaviorCommands(
    behavior.actionCommands || [],
    uniqueStrings([...planCommandsFiltered, ...skillCommandsFiltered])
  );
  const verifyCommandsRaw = mergeBehaviorCommands(behavior.verifyCommands || [], grounding?.verify?.commands || []);
  const notesRaw = uniqueStrings([
    ...(behavior.notes || []),
    ...(product?.notes || []),
    ...notesFromGrounding(grounding),
    ...coverageNotes(coverage)
  ]);
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
  const monitoringIntent = isMonitoringIntent(prompt);
  const officialCandidates = resources
    .filter((resource) => resource.kind === "official")
    .map((resource) => ({ resource, score: scoreResourceForPrompt(prompt, resource) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.resource);

  const officialDocs = (() => {
    // Behavior resources are authoritative for the matched product/subcommand.
    // Only fall back to docSearch when the behavior has no official resources at all.
    if (officialCandidates.length > 0) {
      if (!monitoringIntent) {
        return officialCandidates.slice(0, 2);
      }
      const monitoringDocs = officialCandidates.filter((resource) => isMonitoringResource(resource));
      const docs = monitoringDocs.length > 0 ? [monitoringDocs[0]] : [];
      for (const resource of officialCandidates) {
        if (docs.some((doc) => doc.href === resource.href)) {
          continue;
        }
        docs.push(resource);
        if (docs.length >= 2) {
          break;
        }
      }
      return docs.slice(0, 2);
    }
    // Fallback: docSearch when behavior has no official resources.
    return Array.isArray(docSearch?.docs)
      ? docSearch.docs
          .filter((doc) => typeof doc?.href === "string" && doc.href.trim())
          .map((doc) => ({ title: doc.title || "Documentation", href: doc.href, kind: doc.kind || "guide" }))
          .slice(0, 2)
      : [];
  })();

  const uiLinks = uniqueResourceList(
    []
      .concat(Array.isArray(product?.uiLinks) ? product.uiLinks : [])
      .concat(Array.isArray(behavior.uiLinks) ? behavior.uiLinks : [])
      .concat(uiLinksFromGrounding(grounding))
  ).slice(0, monitoringIntent ? 4 : 3);

  const shouldIncludeLinks = includeLinksInAnswer(prompt);

  if (isStatusQuestion(prompt)) {
    const verdict = statusVerdictFromEvidence(grounding, probeProducts, context);
    const evidence = statusEvidenceText(grounding, probeProducts, context);
    const checkCommand = pickPrimaryStatusCommand(prompt, behavior, product, statusCommands, actionCommands);

    const statusLines = [
      `Answer: ${verdict.verdict}`,
      `Evidence: ${evidence}`,
      "",
      "Check:",
      "```bash",
      checkCommand,
      "```"
    ];

    return statusLines.join("\n");
  }

  // For enable/deploy/configure intents, 'Status: status collected' is unhelpful.
  // Engine-unavailable signals are also unhelpful as a status prefix — use Preflight instead.
  const isGenericBaseline = !groundedBaseline || isGenericStatusMessage(groundedBaseline) || hasEngineUnavailableSignal(grounding);
  const preflightCommand = statusCommands.length > 0 ? statusCommands[0] : null;
  const firstLines = isGenericBaseline && preflightCommand
    ? ["Preflight:", "```bash", preflightCommand, "```"]
    : [`Status: ${baselineState}`];

  const lines = [
    ...firstLines,
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
    if (officialDocs.length === 1) {
      lines.push("", `Docs: ${officialDocs[0].href}`);
    } else {
      lines.push("", "Docs:", ...officialDocs.map((resource) => `- ${resource.href}`));
    }
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

  // Route B code-intent expansion: surface behavior body as an educational supplement.
  // Only when the user explicitly asks for code/internals AND the behavior has authored body content.
  // The model supplement cap is lifted for this path via policy-engine.mjs buildSystemPrompt.
  const behaviorBody = typeof behavior.body === "string" ? behavior.body.trim() : "";
  if (isCodeIntent(prompt) && behaviorBody.length > 0) {
    lines.push("", "## Under the hood", "", behaviorBody);
  }

  return lines.join("\n");
}
