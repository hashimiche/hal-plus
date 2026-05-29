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
