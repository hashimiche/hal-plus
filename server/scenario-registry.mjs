import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCENARIO_DIR = path.resolve(__dirname, "../llm/scenarios");
const CAPABILITIES_FILE = path.join(SCENARIO_DIR, "capabilities.json");
const SHAPES_DIR = path.join(SCENARIO_DIR, "shapes");

function walkMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

export function loadCapabilityGraph() {
  if (!fs.existsSync(CAPABILITIES_FILE)) {
    return { byId: new Map(), all: [] };
  }

  const parsed = JSON.parse(fs.readFileSync(CAPABILITIES_FILE, "utf8"));
  const all = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
  const byId = new Map();
  for (const capability of all) {
    if (capability && capability.id) {
      byId.set(capability.id, capability);
    }
  }

  return { byId, all };
}

function parseScenarioFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const specMatch = raw.match(/<!--\s*hal-plus-scenario\s*([\s\S]*?)-->/i);
  if (!specMatch) {
    return null;
  }

  const spec = JSON.parse(specMatch[1]);
  const body = raw.replace(specMatch[0], "").trim();

  return {
    ...spec,
    body,
    filePath
  };
}

export function loadScenarioShapes() {
  return walkMarkdownFiles(SHAPES_DIR)
    .map((filePath) => parseScenarioFile(filePath))
    .filter(Boolean)
    .sort((left, right) => {
      const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return String(left.id).localeCompare(String(right.id));
    });
}

function normalizePrompt(prompt) {
  return ` ${String(prompt || "").toLowerCase()} `;
}

function countPhraseMatches(promptLower, phrases) {
  let matches = 0;
  for (const phrase of phrases || []) {
    const normalizedPhrase = String(phrase || "").toLowerCase();
    if (normalizedPhrase && promptLower.includes(normalizedPhrase)) {
      matches += 1;
    }
  }
  return matches;
}

function scoreScenarioMatch(shape, promptLower) {
  const intent = shape.intent || {};
  const anyMatches = countPhraseMatches(promptLower, intent.any || []);
  const allTerms = (intent.all || []).map((term) => String(term || "").toLowerCase()).filter(Boolean);

  if ((intent.any || []).length > 0 && anyMatches === 0) {
    return -1;
  }

  if (allTerms.length > 0 && !allTerms.every((term) => promptLower.includes(term))) {
    return -1;
  }

  return Number(shape.priority || 0) + anyMatches * 10 + allTerms.length * 4;
}

function capabilityMatchesShape(capability, shape) {
  const applies = shape.appliesTo || {};
  if (applies.capabilityKind && capability.kind !== applies.capabilityKind) {
    return false;
  }

  for (const field of Array.isArray(applies.requires) ? applies.requires : []) {
    if (!capability[field]) {
      return false;
    }
  }

  return true;
}

function resolvePrimaryCapability(shape, graph, promptLower) {
  // Prefer the explicit hint when it exists and still matches the shape.
  if (shape.primaryCapabilityHint) {
    const hinted = graph.byId.get(shape.primaryCapabilityHint);
    if (hinted && capabilityMatchesShape(hinted, shape)) {
      return hinted;
    }
  }

  // Otherwise pick the best matching capability mentioned in the prompt.
  const candidates = graph.all.filter((capability) => capabilityMatchesShape(capability, shape));
  const mentioned = candidates.filter((capability) => {
    const label = String(capability.label || "").toLowerCase();
    return (
      promptLower.includes(String(capability.id).toLowerCase()) ||
      (label && promptLower.includes(label))
    );
  });

  if (mentioned.length > 0) {
    return mentioned[0];
  }

  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Resolve the full provision order for a capability by walking dependsOn
 * depth-first, parents before the capability itself, de-duplicated.
 */
export function buildProvisionSequence(capability, graph, seen = new Set()) {
  if (!capability || seen.has(capability.id)) {
    return [];
  }
  seen.add(capability.id);

  const sequence = [];
  for (const depId of Array.isArray(capability.dependsOn) ? capability.dependsOn : []) {
    const dep = graph.byId.get(depId);
    if (dep) {
      sequence.push(...buildProvisionSequence(dep, graph, seen));
    }
  }
  sequence.push(capability);
  return sequence;
}

export function resolveScenarioContext(prompt) {
  const promptLower = normalizePrompt(prompt);
  const graph = loadCapabilityGraph();
  const shapes = loadScenarioShapes();

  const ranked = shapes
    .map((shape) => ({ shape, score: scoreScenarioMatch(shape, promptLower) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return { prompt: String(prompt || ""), shape: null, primary: null, provisionSequence: [] };
  }

  const shape = ranked[0].shape;
  const primary = resolvePrimaryCapability(shape, graph, promptLower);
  const provisionSequence = primary ? buildProvisionSequence(primary, graph) : [];

  return {
    prompt: String(prompt || ""),
    shape,
    primary,
    provisionSequence,
    graph
  };
}

export function listRequiredStatusTools(context) {
  const sequence = Array.isArray(context?.provisionSequence) ? context.provisionSequence : [];
  const tools = [];
  const seen = new Set();
  for (const capability of sequence) {
    const tool = capability?.statusTool;
    if (tool && !seen.has(tool)) {
      seen.add(tool);
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * Ordered, de-duplicated list of hal provision commands for the resolved
 * capability subgraph (consecutive duplicates collapsed — e.g. gitlab and
 * tfe_vcs_workflow share `hal terraform vcs-workflow enable`).
 */
export function buildProvisionCommands(context) {
  const sequence = Array.isArray(context?.provisionSequence) ? context.provisionSequence : [];
  const commands = [];
  for (const capability of sequence) {
    const action = capability?.action;
    if (action && commands[commands.length - 1] !== action) {
      commands.push(action);
    }
  }
  return commands;
}

/**
 * Flatten a nested object into dotted-path => value lines, used to surface the
 * exact endpoint/credential values the model must copy verbatim.
 */
function flattenFact(value, prefix = "", out = []) {
  if (value === null || value === undefined) {
    return out;
  }
  if (Array.isArray(value)) {
    const scalars = value.filter((item) => item === null || typeof item !== "object");
    if (scalars.length === value.length) {
      out.push(`${prefix} = [${scalars.map((item) => String(item)).join(", ")}]`);
    } else {
      value.forEach((item, index) => flattenFact(item, `${prefix}[${index}]`, out));
    }
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenFact(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.push(`${prefix} = ${String(value)}`);
  return out;
}

// Leaf fields that already hold a complete URL/endpoint. The model tends to
// genericise URLs when it sees their component parts, so we surface these
// pre-built values explicitly and instruct it to copy them verbatim.
const URL_FIELD_PATTERN = /(_url|web_url|endpoint|address)$/i;

function formatFactValue(fact) {
  const structured = fact && fact.structured && typeof fact.structured === "object" ? fact.structured : null;
  const hasStructured = structured && Object.keys(structured).length > 0;
  if (hasStructured) {
    let json;
    try {
      json = JSON.stringify(structured);
    } catch {
      json = null;
    }
    // Pull complete URLs out separately so the model copies them verbatim
    // rather than rebuilding them from org/project/workspace parts.
    const urls = flattenFact(structured)
      .filter((line) => {
        const path = line.split(" = ")[0];
        const leaf = path.split(".").pop();
        return URL_FIELD_PATTERN.test(leaf || "") && line.includes("http");
      });
    const urlHint = urls.length > 0 ? ` | COPY THESE URLS VERBATIM (do not rebuild from parts): ${urls.join("; ")}` : "";
    if (json) {
      // HAL status tools return canonical endpoints + lab_credentials in their
      // error envelope too (e.g. lab not yet provisioned). Surface those values
      // rather than discarding them; just flag that the lab is not live yet.
      if (fact.ok === false) {
        return `lab not currently running — resolve answer values from these canonical/last-known facts, and tell the user to provision the lab first: ${json}${urlHint}`;
      }
      return `${json}${urlHint}`;
    }
  }
  if (!fact || fact.ok === false) {
    return "tool unavailable (rely on the capability notes below for known lab defaults)";
  }
  const text = String(fact.text || "").trim();
  return text || "no data returned";
}

/**
 * Build the scenario grounding supplement injected into the model's system
 * prompt. Pure: takes the resolved scenario context plus a map of live MCP
 * facts keyed by tool name ({ [tool]: { ok, structured, text } }).
 */
export function buildScenarioPromptSupplement(context, factsByTool = {}) {
  const shape = context?.shape;
  const sequence = Array.isArray(context?.provisionSequence) ? context.provisionSequence : [];
  if (!shape || sequence.length === 0) {
    return "";
  }

  const sections = [];
  sections.push(
    "HAL Plus scenario walkthrough — compose a single educational answer that FOLLOWS the shape below.",
    "Fill each section from its declared source. Never invent hal commands, URLs, or credentials."
  );

  sections.push(`## Scenario shape: ${shape.title} (${shape.id})`);
  if (shape.body) {
    sections.push(shape.body);
  }

  sections.push("## Grounded capability facts (provision order)");
  for (const capability of sequence) {
    const lines = [`### ${capability.label} (${capability.id})`];
    if (capability.action) {
      lines.push(`- Provision command: \`${capability.action}\``);
    }
    if (capability.manualTrigger) {
      lines.push(`- Manual trigger: ${capability.manualTrigger}`);
    }
    if (capability.observable?.what) {
      lines.push(`- Observable result: ${capability.observable.what}`);
    }
    if (capability.observable?.linkFrom) {
      lines.push(`- Observable link JSON path (resolve against this capability's Live status data; never print the path literally): ${capability.observable.linkFrom}`);
    }
    const surfaces = capability.access?.surfaces || [];
    const credentials = capability.access?.credentials || [];
    if (surfaces.length > 0 || credentials.length > 0) {
      lines.push(`- Access JSON paths (each is a path INTO this capability's Live status data — resolve to the actual value, never print the path): surfaces=[${surfaces.join(", ")}] credentials=[${credentials.join(", ")}]`);
    }
    if (capability.notes) {
      lines.push(`- Lab defaults / notes: ${capability.notes}`);
    }
    if (capability.statusTool) {
      lines.push(`- Live status (${capability.statusTool}): ${formatFactValue(factsByTool[capability.statusTool])}`);
    }
    sections.push(lines.join("\n"));
  }

  sections.push(
    "## Deterministic sections (DO NOT WRITE THESE YOURSELF)",
    [
      "- The **Access** section body and the verbatim links inside **Observe** are inserted AUTOMATICALLY by the server from live MCP data, so you do NOT need to get URLs or credentials exactly right.",
      "- Under the `## Access` heading, write only this single placeholder line and nothing else: `(access details inserted automatically)`.",
      "- In the `## Observe` section, explain the flow in prose but do NOT write any URL — the exact links are appended automatically below your prose.",
      "- Everywhere else, never print a raw URL or credential value; refer to them in words (e.g. 'the workspace URL', 'the TFE admin login'). The Access section is the single source of truth for those values."
    ].join("\n")
  );

  sections.push(
    "## Grounding rules",
    [
      "- Provision commands: use ONLY the commands listed above, in order, with duplicates collapsed.",
      "- Live facts (URLs, endpoints, credentials): take from the Live status blocks or the capability notes — never fabricate.",
      "- Dotted tokens such as `tfe.runs_url`, `gitlab.web_url`, `tfe.workspace_url`, `lab_credentials.tfe_admin`, `lab_credentials.gitlab` are JSON PATHS into the matching capability's Live status `data`. ALWAYS resolve them to the real value and show the value (e.g. print `haladmin` / `hal9000FTW` / the actual URL). NEVER print a dotted path literally in the answer.",
      "- When a path resolves to a URL/endpoint, copy that value VERBATIM — do not rebuild it from org/project/workspace parts, change its casing, or drop path segments (e.g. keep the `/app/` segment and the exact workspace name).",
      "- If a path cannot be resolved (no data at all), describe the item in plain words (e.g. 'the TFE admin username the CLI prints') — do NOT print the path and do NOT invent a value.",
      "- If a Live status block says the lab is not currently running, still present the canonical endpoints/credentials, but add a short note that the user must run the provision commands first before they work.",
      "- 'Under the hood': break the mechanism into its key components and attach the single most relevant link INLINE to each component (a specific doc section, tutorial step, API endpoint, or video timestamp from the documentation evidence). Prefer targeted links over a generic recap.",
      "- 'Learn more': list ONLY typed source cards that carry a REAL link taken verbatim from the documentation evidence; every card MUST end with its evidence URL. If a source type (tutorial, validated design, validated pattern, video) has no matching evidence link, OMIT that card entirely — NEVER write a card whose link is missing, '(no specific link provided)', 'not in the corpus', a bare label like '[Tutorial]', or any other placeholder. If the evidence has no linkable sources at all, omit the 'Learn more' section completely.",
      "- CRITICAL: every link must come from the documentation evidence provided separately. NEVER invent, guess, or emit placeholder links (e.g. '[Design]', '[Tutorial]', bare labels). If no evidence matches a component, explain it plainly and omit the link; if the evidence is empty, say the curated sources are not available yet rather than inventing any.",
      "- Lab credentials shown above are non-secret demo values and may be displayed."
    ].join("\n")
  );

  return sections.join("\n\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Deterministic Access / Observe rendering.
//
// Small local models reliably mangle long URLs (rebuilding them from org/
// project/workspace parts) and sometimes drop credentials. Rather than trust
// the model, we resolve the exact surfaces, credentials, and observable links
// from the live MCP tool data ourselves and splice them into the answer. The
// model only writes narrative prose.
// ───────────────────────────────────────────────────────────────────────────

function resolvePath(root, dottedPath) {
  if (!root || typeof root !== "object") {
    return undefined;
  }
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function resolvePathAcrossFacts(dottedPath, factsByTool) {
  for (const fact of Object.values(factsByTool || {})) {
    const value = resolvePath(fact?.structured, dottedPath);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

const SURFACE_LABELS = {
  "tfe.workspace_url": "TFE workspace",
  "tfe.runs_url": "TFE runs page",
  "gitlab.web_url": "GitLab project"
};

const CREDENTIAL_LABELS = {
  "lab_credentials.tfe_admin": "Terraform Enterprise admin",
  "lab_credentials.gitlab": "GitLab"
};

// Maps a lab_credentials.<leaf> path to a `hal creds status` service id, so
// credentials can be sourced from the authoritative get_active_credentials tool
// when that service is covered there (e.g. TFE). GitLab is not a creds-status
// service, so it falls back to the workflow tool's lab_credentials block.
const CREDENTIAL_LEAF_TO_CREDS_SERVICE = {
  tfe_admin: "tfe"
};

function labelForSurface(pathStr) {
  if (SURFACE_LABELS[pathStr]) {
    return SURFACE_LABELS[pathStr];
  }
  const [ns, ...rest] = String(pathStr).split(".");
  const leaf = (rest.pop() || "").replace(/_(url|endpoint|address)$/i, "");
  return `${ns} ${leaf}`.trim();
}

function labelForCredential(pathStr) {
  if (CREDENTIAL_LABELS[pathStr]) {
    return CREDENTIAL_LABELS[pathStr];
  }
  return String(pathStr).split(".").pop().replace(/_/g, " ");
}

function credentialFromCredsStatus(leaf, factsByTool) {
  const creds = factsByTool?.get_active_credentials?.structured;
  const serviceId = CREDENTIAL_LEAF_TO_CREDS_SERVICE[leaf];
  if (!serviceId || !creds || !Array.isArray(creds.services)) {
    return undefined;
  }
  const service = creds.services.find((svc) => svc.service === serviceId);
  if (!service || !Array.isArray(service.entries)) {
    return undefined;
  }
  const withBoth = service.entries.find((entry) => entry.username && entry.secret);
  if (withBoth) {
    return { username: withBoth.username, password: withBoth.secret };
  }
  const withUser = service.entries.find((entry) => entry.username);
  if (withUser) {
    return { username: withUser.username, password: withUser.secret };
  }
  return undefined;
}

function renderCredentialValue(value) {
  if (value && typeof value === "object") {
    const user = value.username ?? value.user ?? value.login;
    const secret = value.password ?? value.secret ?? value.token;
    if (user && secret) {
      return `\`${user}\` / \`${secret}\``;
    }
    if (user) {
      return `\`${user}\``;
    }
    if (secret) {
      return `\`${secret}\``;
    }
    return null;
  }
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return `\`${String(value)}\``;
}

/**
 * Resolve the exact Access surfaces/credentials and Observe links for a scenario
 * from live MCP facts. Returns markdown blocks (or null when nothing resolves).
 *   { accessBlock, observeLinks }
 */
export function buildDeterministicScenarioBlocks(context, factsByTool = {}) {
  const primary = context?.primary;
  const sequence = Array.isArray(context?.provisionSequence) ? context.provisionSequence : [];
  if (!primary) {
    return { accessBlock: null, observeLinks: null };
  }

  const surfacePaths = Array.isArray(primary.access?.surfaces) ? primary.access.surfaces : [];
  const credentialPaths = Array.isArray(primary.access?.credentials) ? primary.access.credentials : [];

  const surfaceLines = [];
  for (const pathStr of surfacePaths) {
    const value = resolvePathAcrossFacts(pathStr, factsByTool);
    if (typeof value === "string" && value.trim()) {
      surfaceLines.push(`- ${labelForSurface(pathStr)}: ${value.trim()}`);
    }
  }

  const credentialLines = [];
  for (const pathStr of credentialPaths) {
    const leaf = String(pathStr).split(".").pop();
    const value = credentialFromCredsStatus(leaf, factsByTool) ?? resolvePathAcrossFacts(pathStr, factsByTool);
    const rendered = renderCredentialValue(value);
    if (rendered) {
      credentialLines.push(`- ${labelForCredential(pathStr)}: ${rendered}`);
    }
  }

  const accessParts = [];
  if (surfaceLines.length > 0) {
    accessParts.push(["**Endpoints**", ...surfaceLines].join("\n"));
  }
  if (credentialLines.length > 0) {
    accessParts.push(["**Credentials** (non-secret lab demo values)", ...credentialLines].join("\n"));
  }
  const accessBlock = accessParts.length > 0 ? accessParts.join("\n\n") : null;

  // Observe links: resolve each capability's observable.linkFrom, de-duplicated by URL.
  const observeLines = [];
  const seenUrls = new Set();
  for (const capability of sequence) {
    const linkPath = capability?.observable?.linkFrom;
    if (!linkPath) {
      continue;
    }
    const value = resolvePathAcrossFacts(linkPath, factsByTool);
    if (typeof value === "string" && value.trim() && !seenUrls.has(value.trim())) {
      seenUrls.add(value.trim());
      observeLines.push(`- ${labelForSurface(linkPath)}: ${value.trim()}`);
    }
  }
  const observeLinks = observeLines.length > 0 ? observeLines.join("\n") : null;

  return { accessBlock, observeLinks };
}

const SECTION_HEADING_PATTERN = /^#{1,6}\s+/;
// Literal JSON-path leaks like `tfe.workspace_url` or `lab_credentials.tfe_admin`.
// The negative lookbehind for URL/host characters (/, :, ., word) prevents this
// from matching real hostnames such as `tfe.localhost` inside a URL.
const LEAKED_PATH_PATTERN = /(?<![\w/:.])(?:tfe|gitlab|lab_credentials)\.[a-z_]+(?:\.[a-z_]+)?/gi;
const URL_PATTERN = /https?:\/\/\S+/g;

function findSectionBounds(lines, headingMatcher) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (SECTION_HEADING_PATTERN.test(lines[i]) && headingMatcher.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (SECTION_HEADING_PATTERN.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Splice the deterministic Access body and Observe links into the model's
 * answer. The model is instructed to leave a placeholder under `## Access` and
 * to omit URLs in `## Observe`; here we enforce that deterministically and
 * scrub any leaked dotted paths.
 */
export function spliceDeterministicSections(answerText, blocks = {}) {
  let text = String(answerText || "");
  const { accessBlock, observeLinks } = blocks;

  let lines = text.split("\n");

  // Access: replace the whole section body with the deterministic block.
  if (accessBlock) {
    const bounds = findSectionBounds(lines, /access/i);
    if (bounds) {
      const heading = lines[bounds.start];
      lines = [
        ...lines.slice(0, bounds.start),
        heading,
        "",
        accessBlock,
        "",
        ...lines.slice(bounds.end)
      ];
    }
  }

  // Observe: keep the model's prose, strip any URLs it wrote, append verbatim links.
  if (observeLinks) {
    const bounds = findSectionBounds(lines, /observe/i);
    if (bounds) {
      const bodyLines = lines
        .slice(bounds.start + 1, bounds.end)
        .map((line) => line.replace(URL_PATTERN, "the link below"));
      const rebuilt = [
        lines[bounds.start],
        ...bodyLines,
        "",
        "**Open it directly:**",
        observeLinks,
        ""
      ];
      lines = [...lines.slice(0, bounds.start), ...rebuilt, ...lines.slice(bounds.end)];
    }
  }

  text = lines.join("\n");

  // Defensive: never leave a literal dotted path in the rendered answer.
  text = text.replace(LEAKED_PATH_PATTERN, (match) => {
    const leaf = match.split(".").pop().replace(/_/g, " ");
    return `the ${leaf}`;
  });

  return text;
}

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL_PATTERN = /https?:\/\/[^\s)\]]+/g;

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/[).,;:\]]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Collect the set of URLs the model is actually grounded in for a scenario:
 * the retrieved corpus section links (chunks[].href) plus the canonical lab
 * URLs we splice into the deterministic Access/Observe blocks. Any other URL
 * the small model emits is, by definition, ungrounded (i.e. invented).
 */
export function collectGroundedScenarioUrls(scenarioDocs = {}, deterministicBlocks = {}) {
  const urls = [];
  const chunks = Array.isArray(scenarioDocs?.chunks) ? scenarioDocs.chunks : [];
  for (const chunk of chunks) {
    if (chunk?.href) urls.push(chunk.href);
  }
  const docs = Array.isArray(scenarioDocs?.docs) ? scenarioDocs.docs : [];
  for (const doc of docs) {
    if (doc?.href) urls.push(doc.href);
    else if (doc?.url) urls.push(doc.url);
  }
  for (const block of [deterministicBlocks?.accessBlock, deterministicBlocks?.observeLinks]) {
    if (typeof block !== "string") continue;
    for (const match of block.matchAll(BARE_URL_PATTERN)) {
      urls.push(match[0]);
    }
  }
  return urls;
}

/**
 * Strip any link the model invented. Markdown links whose target is not in the
 * grounded allowlist are collapsed to their visible label; bare ungrounded URLs
 * are removed. This is the deterministic guard against fabricated documentation
 * links (e.g. plausible-looking but non-existent `developer.hashicorp.com/.../tfx/*`
 * pages for the community `tfx` CLI). Grounded corpus and lab URLs are preserved.
 */
export function scrubUngroundedLinks(answerText, allowedUrls = []) {
  let text = String(answerText || "");
  const allowed = new Set((allowedUrls || []).map(normalizeUrl).filter(Boolean));
  // Without a grounded allowlist we cannot distinguish real from invented; in
  // that case leave the answer untouched rather than stripping every link.
  if (allowed.size === 0) {
    return text;
  }

  text = text.replace(MARKDOWN_LINK_PATTERN, (full, label, url) =>
    allowed.has(normalizeUrl(url)) ? full : label
  );

  text = text.replace(BARE_URL_PATTERN, (url) =>
    allowed.has(normalizeUrl(url)) ? url : ""
  );

  // Tidy up artifacts left by removed bare URLs: empty parens, trailing
  // "see " / "at " danglers, doubled spaces, and spaces before newlines.
  text = text
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");

  return text;
}

const LEARN_MORE_HEADING_PATTERN = /^#{1,6}\s+learn more\s*$/i;
const ANY_HEADING_PATTERN = /^#{1,6}\s+\S/;

/**
 * Remove "Learn more" cards that have no real link. The scenario model is told
 * to emit only link-backed source cards, but small models still pad the section
 * with tutorial/validated-pattern cards that admit "(no specific link provided)".
 * A linkless card is useless to the reader, so we drop it deterministically:
 * within the `Learn more` section, blank-line-separated blocks that contain no
 * URL are removed; if nothing linkable remains, the whole section (heading
 * included) is dropped.
 */
export function pruneLinklessLearnMore(answerText) {
  const lines = String(answerText || "").split("\n");

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (LEARN_MORE_HEADING_PATTERN.test(lines[i].trim())) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) {
    return String(answerText || "");
  }

  // Section body runs until the next heading (or end of document).
  let endIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (ANY_HEADING_PATTERN.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  // Split the body into blank-line-separated blocks (one per source card).
  const blocks = [];
  let current = [];
  for (const line of lines.slice(headingIdx + 1, endIdx)) {
    if (line.trim() === "") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length) {
    blocks.push(current);
  }

  const kept = blocks.filter((block) => /https?:\/\//i.test(block.join("\n")));

  let rebuilt;
  if (kept.length === 0) {
    // Nothing linkable — drop the whole "Learn more" section.
    rebuilt = [...lines.slice(0, headingIdx), ...lines.slice(endIdx)];
  } else {
    const bodyOut = [];
    kept.forEach((block, idx) => {
      if (idx > 0) bodyOut.push("");
      bodyOut.push(...block);
    });
    rebuilt = [
      ...lines.slice(0, headingIdx + 1),
      "",
      ...bodyOut,
      "",
      ...lines.slice(endIdx)
    ];
  }

  return rebuilt
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "")
    .concat("\n");
}

