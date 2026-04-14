export function parseHalStatus(raw) {
  const lines = String(raw || "").split("\n");
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

function normalizeProductLabel(name) {
  const value = String(name || "").toLowerCase();
  if (value === "terraform") {
    return "Terraform Enterprise";
  }
  if (value === "obs") {
    return "Observability";
  }
  if (!value) {
    return "Unknown";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeState(state) {
  const value = String(state || "").toLowerCase();
  if (value === "running") {
    return "running";
  }
  if (value === "not_deployed") {
    return "not-deployed";
  }
  return "unknown";
}

export function baselineProductsToUi(runtime) {
  const products = Array.isArray(runtime?.products) ? runtime.products : [];
  return products.map((product) => {
    const featureRows = Array.isArray(product?.features) ? product.features : [];
    return {
      name: normalizeProductLabel(product?.product),
      state: normalizeState(product?.state),
      endpoint: typeof product?.endpoint === "string" ? product.endpoint : "-",
      version: "-",
      features: featureRows
        .map((row) => {
          const key = typeof row?.feature === "string" ? row.feature : null;
          const value = typeof row?.state === "string" ? row.state : null;
          return key && value ? `${key}:${value}` : null;
        })
        .filter(Boolean)
    };
  });
}

export function lokiStateFromBaseline(runtime) {
  const products = Array.isArray(runtime?.products) ? runtime.products : [];
  const obs = products.find((product) => String(product?.product || "").toLowerCase() === "obs");
  if (!obs || !Array.isArray(obs.features)) {
    return false;
  }
  return obs.features.some((row) => row?.feature === "loki" && row?.state === "enabled");
}

export async function getOllamaRuntime(baseUrl, model, contextWindow) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return { ok: false, detail: `${baseUrl} · not reachable` };
    }
    const data = await response.json();
    const hasModel = Array.isArray(data?.models)
      ? data.models.some((m) => typeof m?.name === "string" && m.name.startsWith(model))
      : false;
    return {
      ok: hasModel,
      model,
      contextWindow,
      detail: hasModel
        ? `${baseUrl} · model ${model} ready`
        : `${baseUrl} · model ${model} missing`
    };
  } catch {
    return {
      ok: false,
      model,
      contextWindow,
      detail: `${baseUrl} · not reachable`
    };
  }
}
