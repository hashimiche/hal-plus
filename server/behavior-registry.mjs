import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRODUCT_BEHAVIOR_DIR = path.resolve(__dirname, "../llm/products");

function walkMarkdownFiles(dirPath) {
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

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function parseBehaviorFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const specMatch = raw.match(/<!--\s*hal-plus-spec\s*([\s\S]*?)-->/i);
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

function loadBehaviorCatalog() {
  if (!fs.existsSync(PRODUCT_BEHAVIOR_DIR)) {
    return [];
  }

  return walkMarkdownFiles(PRODUCT_BEHAVIOR_DIR)
    .map((filePath) => parseBehaviorFile(filePath))
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

function scoreBehaviorMatch(behavior, promptLower) {
  const match = behavior.match || {};
  const anyMatches = countPhraseMatches(promptLower, match.any || []);
  const allTerms = (match.all || []).map((term) => String(term || "").toLowerCase()).filter(Boolean);

  if ((match.any || []).length > 0 && anyMatches === 0) {
    return -1;
  }

  if (allTerms.length > 0 && !allTerms.every((term) => promptLower.includes(term))) {
    return -1;
  }

  const specificityBoost = behavior.subcommand && behavior.subcommand !== "product" ? 6 : 0;
  return Number(behavior.priority || 0) + anyMatches * 10 + allTerms.length * 4 + specificityBoost;
}

function behaviorToClientModel(behavior) {
  return {
    id: behavior.id,
    title: behavior.title,
    summary: behavior.summary || "",
    subcommand: behavior.subcommand,
    focusBullets: Array.isArray(behavior.focusBullets) ? behavior.focusBullets : [],
    samplePrompts: Array.isArray(behavior.samplePrompts) ? behavior.samplePrompts : [],
    matchTerms: uniqueBy([...(behavior.match?.any || []), ...(behavior.match?.all || [])], (item) => item.toLowerCase())
  };
}

export function resolveBehaviorContext(prompt) {
  const promptLower = normalizePrompt(prompt);
  const catalog = loadBehaviorCatalog();
  const matches = catalog
    .map((behavior) => ({ behavior, score: scoreBehaviorMatch(behavior, promptLower) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  const primary = matches.length > 0 ? matches[0].behavior : null;
  if (!primary) {
    return {
      prompt: String(prompt || ""),
      primary: null,
      product: null,
      selected: [],
      related: []
    };
  }

  const product =
    primary.subcommand === "product"
      ? primary
      : catalog.find((behavior) => behavior.product === primary.product && behavior.subcommand === "product") || null;

  const selected = [];
  if (product) {
    selected.push(product);
  }
  if (primary && (!product || product.id !== primary.id)) {
    selected.push(primary);
  }

  const related = product
    ? catalog
        .filter((behavior) => behavior.product === product.product && !selected.some((item) => item.id === behavior.id))
        .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))
    : [];

  return {
    prompt: String(prompt || ""),
    primary,
    product,
    selected,
    related
  };
}

export function buildBehaviorPromptSupplement(context) {
  const selected = Array.isArray(context?.selected) ? context.selected : [];
  if (selected.length === 0) {
    return "";
  }

  const sections = ["HAL Plus grounded behavior packs:"];

  for (const behavior of selected) {
    sections.push(`## ${behavior.title}`);
    if (behavior.summary) {
      sections.push(behavior.summary);
    }
    sections.push(behavior.body);
  }

  return sections.join("\n\n");
}

export function collectBehaviorResources(context) {
  const seen = new Set();
  const ordered = [];
  const candidates = [
    ...(Array.isArray(context?.selected) ? context.selected : []),
    ...(Array.isArray(context?.related) ? context.related : [])
  ];

  for (const behavior of candidates) {
    for (const resource of Array.isArray(behavior?.resources) ? behavior.resources : []) {
      if (!resource?.href || seen.has(resource.href)) {
        continue;
      }
      seen.add(resource.href);
      ordered.push(resource);
    }
  }

  return ordered;
}

export function buildBehaviorCatalogSummary() {
  const catalog = loadBehaviorCatalog();
  const products = catalog
    .filter((behavior) => behavior.subcommand === "product")
    .map((product) => {
      const subcommands = catalog
        .filter((behavior) => behavior.product === product.product && behavior.subcommand !== "product")
        .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));

      return {
        id: product.product,
        label: product.productLabel || product.product,
        title: product.title,
        summary: product.summary || "",
        focusBullets: Array.isArray(product.focusBullets) ? product.focusBullets : [],
        samplePrompts: Array.isArray(product.samplePrompts) ? product.samplePrompts : [],
        matchTerms: uniqueBy([...(product.match?.any || []), ...(product.match?.all || [])], (item) => item.toLowerCase()),
        resources: uniqueBy(
          [
            ...(Array.isArray(product.resources) ? product.resources : []),
            ...subcommands.flatMap((behavior) => (Array.isArray(behavior.resources) ? behavior.resources : []))
          ],
          (item) => item.href
        ),
        uiLinks: uniqueBy(
          [
            ...(Array.isArray(product.uiLinks) ? product.uiLinks : []),
            ...subcommands.flatMap((behavior) => (Array.isArray(behavior.uiLinks) ? behavior.uiLinks : []))
          ],
          (item) => item.href
        ),
        subcommands: subcommands.map((behavior) => behaviorToClientModel(behavior))
      };
    });

  return { products };
}
