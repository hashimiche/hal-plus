import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
  ts: string;
};

type ThemeVersion = {
  className: string;
  label: string;
  path: string;
};

type HealthState = "ok" | "warn" | "neutral";

type HalProduct = {
  name: string;
  state: "running" | "not-deployed" | "unknown";
  endpoint: string;
  version: string;
  features: string[];
};

type LiveStatus = {
  runtime: {
    loki: { ok: boolean; detail: string };
    llm: { ok: boolean; detail: string; model?: string; contextWindow?: number };
    halMcp: { ok: boolean; detail: string };
  };
  products: HalProduct[];
};

type HealthChip = {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  kind?: "runtime" | "product";
  product?: HalProduct;
};

type CatalogLink = {
  title: string;
  href: string;
  kind?: string;
  description?: string;
};

type CatalogSubcommand = {
  id: string;
  title: string;
  summary: string;
  subcommand: string;
  focusBullets: string[];
  samplePrompts: string[];
  matchTerms: string[];
};

type CatalogProduct = {
  id: string;
  label: string;
  title: string;
  summary: string;
  focusBullets: string[];
  samplePrompts: string[];
  matchTerms: string[];
  resources: CatalogLink[];
  uiLinks: CatalogLink[];
  subcommands: CatalogSubcommand[];
};

type BehaviorCatalog = {
  products: CatalogProduct[];
};

const themeVersions: ThemeVersion[] = [
  { className: "theme-light", label: "Studio", path: "/" },
  { className: "theme-dark", label: "After Hours", path: "/dark" }
];

const defaultProducts: HalProduct[] = [
  { name: "Consul", state: "unknown", endpoint: "no data", version: "n/a", features: [] },
  { name: "Vault", state: "unknown", endpoint: "no data", version: "n/a", features: [] },
  { name: "Nomad", state: "unknown", endpoint: "no data", version: "n/a", features: [] },
  { name: "Boundary", state: "unknown", endpoint: "no data", version: "n/a", features: [] },
  { name: "TFE", state: "unknown", endpoint: "no data", version: "n/a", features: [] },
  { name: "Observability", state: "unknown", endpoint: "no data", version: "n/a", features: [] }
];

function getThemeFromPath(pathname: string): ThemeVersion {
  return themeVersions.find((theme) => theme.path === pathname) ?? themeVersions[0];
}

function nowTs(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value.trim());
}

function scoreTerms(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  return terms.reduce((score, term) => (term && lower.includes(term.toLowerCase()) ? score + 1 : score), 0);
}

function runtimeProductToCatalogId(productName: string): string | null {
  const normalized = productName.toLowerCase();
  if (normalized === "tfe") {
    return "terraform";
  }

  if (normalized === "observability") {
    return "observability";
  }

  return normalized;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function uniqueLinks(items: CatalogLink[]): CatalogLink[] {
  const seen = new Set<string>();
  const result: CatalogLink[] = [];

  for (const item of items) {
    if (!item?.href || seen.has(item.href)) {
      continue;
    }
    seen.add(item.href);
    result.push(item);
  }

  return result;
}

function scoreDocLink(prompt: string, product: CatalogProduct | null, link: CatalogLink): number {
  const haystack = [link.title, link.description, link.kind].filter(Boolean).join(" ").toLowerCase();
  const promptLower = String(prompt || "").toLowerCase();
  const productTerms = product
    ? [product.label, product.title, ...(product.matchTerms || []), ...product.subcommands.flatMap((subcommand) => subcommand.matchTerms || [])]
    : [];

  let score = 0;
  if (link.kind === "official") {
    score += 10;
  }
  score += scoreTerms(haystack, productTerms.filter(Boolean));
  score += scoreTerms(haystack, promptLower.split(/\W+/).filter(Boolean));
  return score;
}

function seededScore(value: string, seed: number): number {
  let hash = seed || 1;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

function shouldShowDocsForPrompt(prompt: string): boolean {
  const lower = String(prompt || "").toLowerCase();
  if (!lower.trim()) {
    return false;
  }

  const docIntent = ["how", "deploy", "setup", "configure", "tutorial", "guide", "workflow", "learn", "troubleshoot", "fix"];
  const statusOnlyIntent = ["status", "running", "up", "health", "local instance", "is my", "is tfe", "check"];

  const hasDocIntent = docIntent.some((term) => lower.includes(term));
  const hasStatusIntent = statusOnlyIntent.some((term) => lower.includes(term));

  if (hasDocIntent) {
    return true;
  }

  if (hasStatusIntent) {
    return false;
  }

  return false;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [catalog, setCatalog] = useState<BehaviorCatalog | null>(null);
  const [docSuggestions, setDocSuggestions] = useState<CatalogLink[]>([]);
  const [suggestionSeed, setSuggestionSeed] = useState(() => Math.floor(Math.random() * 100000));
  const formRef = useRef<HTMLFormElement>(null);
  const theme = getThemeFromPath(window.location.pathname);

  const estimatedTokens = useMemo(() => {
    const chars = messages.reduce((sum, message) => sum + message.text.length, 0) + input.length;
    return Math.max(0, Math.ceil(chars / 4));
  }, [input.length, messages]);

  const latestUserPrompt = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        return messages[index].text;
      }
    }
    return "";
  }, [messages]);

  const contextWindow = liveStatus?.runtime.llm.contextWindow || 32768;
  const tokenPercent = Math.min(100, Math.round((estimatedTokens / contextWindow) * 100));
  const tokenState: HealthState = tokenPercent > 80 ? "warn" : "ok";
  const displayProducts = liveStatus?.products?.length ? liveStatus.products : defaultProducts;

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/status");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as LiveStatus;
        setLiveStatus(data);
      } catch {
        // Keep previous status on transient polling errors.
      }
    };

    const fetchCatalog = async () => {
      try {
        const response = await fetch("/api/catalog");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as BehaviorCatalog;
        setCatalog(data);
      } catch {
        // Ignore catalog bootstrap errors and keep the UI functional.
      }
    };

    void fetchStatus();
    void fetchCatalog();

    const interval = window.setInterval(fetchStatus, 12000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!shouldShowDocsForPrompt(latestUserPrompt)) {
      setDocSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const fetchDocs = async () => {
      try {
        const response = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: latestUserPrompt }),
          signal: controller.signal
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { docs?: CatalogLink[] };
        setDocSuggestions(Array.isArray(data.docs) ? data.docs : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    };

    void fetchDocs();

    return () => controller.abort();
  }, [latestUserPrompt]);

  const activeCatalogProduct = useMemo(() => {
    const products = catalog?.products || [];
    if (products.length === 0) {
      return null;
    }

    const promptScores = products
      .map((product) => {
        const directScore = scoreTerms(latestUserPrompt, product.matchTerms);
        const subcommandScore = product.subcommands.reduce(
          (score, subcommand) => score + scoreTerms(latestUserPrompt, subcommand.matchTerms),
          0
        );

        return {
          product,
          score: directScore + subcommandScore
        };
      })
      .sort((left, right) => right.score - left.score);

    if (promptScores[0] && promptScores[0].score > 0) {
      return promptScores[0].product;
    }

    const runningCatalogId = displayProducts
      .filter((product) => product.state === "running")
      .map((product) => runtimeProductToCatalogId(product.name))
      .find((catalogId) => catalogId && products.some((product) => product.id === catalogId));

    if (runningCatalogId) {
      return products.find((product) => product.id === runningCatalogId) || products[0];
    }

    return products.find((product) => product.id === "terraform") || products[0];
  }, [catalog?.products, displayProducts, latestUserPrompt]);

  const activeSuggestions = useMemo(() => {
    const products = catalog?.products || [];
    if (products.length === 0) {
      return [];
    }

    const pool = uniqueStrings(
      products.flatMap((product) => [
        ...(product.samplePrompts || []),
        ...product.subcommands.flatMap((subcommand) => subcommand.samplePrompts || [])
      ])
    );

    return pool
      .map((prompt) => ({ prompt, score: seededScore(prompt, suggestionSeed) }))
      .sort((left, right) => left.score - right.score)
      .slice(0, 5)
      .map((entry) => entry.prompt);
  }, [catalog?.products, suggestionSeed]);

  const relevantDocs = useMemo(() => {
    const products = catalog?.products || [];
    if (products.length === 0) {
      return [];
    }

    const target = activeCatalogProduct || products[0];
    const docs = uniqueLinks(target.resources || []);
    return docs
      .map((doc) => ({ ...doc, score: scoreDocLink(latestUserPrompt, target, doc) }))
      .sort((left, right) => right.score - left.score || String(left.title).localeCompare(String(right.title)))
      .slice(0, 6);
  }, [activeCatalogProduct, catalog?.products, latestUserPrompt]);

  const visibleDocs = useMemo(() => {
    if (!shouldShowDocsForPrompt(latestUserPrompt)) {
      return [];
    }

    if (docSuggestions.length > 0) {
      return docSuggestions.slice(0, 4);
    }

    return relevantDocs.filter((doc) => doc.score > 0).slice(0, 4);
  }, [docSuggestions, latestUserPrompt, relevantDocs]);

  const showDocsSidebar = visibleDocs.length > 0;

  const healthChips: HealthChip[] = useMemo(
    () => {
      const runtimeChips: HealthChip[] = [
        {
          id: "hal-mcp",
          label: "MCP",
          state: liveStatus ? (liveStatus.runtime.halMcp.ok ? "ok" : "neutral") : "neutral",
          detail: liveStatus?.runtime.halMcp.detail || "offline / no data",
          kind: "runtime"
        }
      ];

      const productChips: HealthChip[] = displayProducts.map((product) => ({
        id: `product-${product.name.toLowerCase()}`,
        label: product.name,
        state: product.state === "running" ? "ok" : "neutral",
        detail: product.state,
        kind: "product",
        product
      }));

      return [
        ...runtimeChips,
        ...productChips,
        {
          id: "token",
          label: `Context ${tokenPercent}%`,
          state: tokenState,
          detail: `${estimatedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens · ${Math.max(
            contextWindow - estimatedTokens,
            0
          ).toLocaleString()} remaining`,
          kind: "runtime"
        }
      ];
    },
    [contextWindow, displayProducts, estimatedTokens, liveStatus, tokenPercent, tokenState]
  );

  const chipDot = (chip: HealthChip): string => {
    if (chip.kind === "product") {
      if (chip.product?.state === "running") {
        return "●";
      }
      if (chip.product?.state === "not-deployed") {
        return "○";
      }
      return "◌";
    }

    if (chip.state === "ok") {
      return "●";
    }
    if (chip.state === "warn") {
      return "◐";
    }
    return "○";
  };

  const renderChipOverlay = (chip: HealthChip) => {
    if (chip.kind === "product" && chip.product) {
      return (
        <div className="chip-overlay product-overlay" role="presentation">
          <div className="chip-overlay-head product-overlay-head">
            <strong>{chip.product.name}</strong>
            <span>{chip.product.state}</span>
          </div>
          <p>{chip.product.version && chip.product.version !== "n/a" ? `Version ${chip.product.version}` : "Version unavailable"}</p>
          <p>{chip.product.endpoint || "No endpoint discovered"}</p>
          {chip.product.features.length > 0 ? (
            <div className="chip-overlay-tags product-overlay-features">
              {chip.product.features.slice(0, 4).map((feature) => (
                <span key={feature}>{feature}</span>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (chip.id === "token") {
      return (
        <div className="chip-overlay runtime-overlay" role="presentation">
          <div className="chip-overlay-head">
            <strong>Context Window</strong>
            <span>{tokenPercent}% used</span>
          </div>
          <p>{chip.detail}</p>
          <div className="chip-overlay-tags">
            <span>{liveStatus?.runtime.llm.model || "model unknown"}</span>
            <span>{contextWindow.toLocaleString()} token window</span>
          </div>
        </div>
      );
    }

    if (chip.id === "hal-mcp") {
      return (
        <div className="chip-overlay runtime-overlay" role="presentation">
          <div className="chip-overlay-head">
            <strong>HAL MCP</strong>
            <span>{chip.state === "ok" ? "ready" : "degraded"}</span>
          </div>
          <p>{chip.detail}</p>
          <div className="chip-overlay-tags">
            <span>Grounding source</span>
            <span>Runtime truth</span>
          </div>
        </div>
      );
    }

    return null;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const prompt = input.trim();
    if (!prompt || isSending) {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      ts: nowTs()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      ts: nowTs()
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const conversation = [...messages, userMessage].map((message) => ({ role: message.role, content: message.text }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation })
      });

      if (!response.ok || !response.body) {
        const fallback = await response.text();
        throw new Error(fallback || "Failed to stream chat response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const payloadLine = evt.split("\n").find((line) => line.startsWith("data:"));
          if (!payloadLine) {
            continue;
          }

          const payloadRaw = payloadLine.replace(/^data:\s*/, "");
          const payload = JSON.parse(payloadRaw) as { type: string; content?: string; message?: string };

          if (payload.type === "chunk" && payload.content) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, text: message.text + payload.content } : message
              )
            );
          }

          if (payload.type === "error") {
            throw new Error(payload.message || "Streaming failed.");
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantId ? { ...entry, text: `Error while contacting Ollama:\n\n${message}` } : entry
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    setInput("");
    setIsSending(false);
    setSuggestionSeed(Math.floor(Math.random() * 100000));
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <div className={`app-shell ${theme.className} ${showDocsSidebar ? "has-docs" : "no-docs"}`}>
      {showDocsSidebar ? (
      <aside className="left-column">
        <section className="panel utility-panel docs-panel">
          <header className="panel-header">
            <span className="panel-kicker">Documentation</span>
            <h2>Relevant Sources</h2>
            <p>{activeCatalogProduct?.label ? `For ${activeCatalogProduct.label}` : "Based on your current question."}</p>
          </header>
          <ul className="docs-list">
            {visibleDocs.map((doc) => (
              <li key={doc.href} className={`doc-card ${doc === visibleDocs[0] ? "featured-doc" : ""}`}>
                <div className="doc-kind">{doc.kind || "guide"}</div>
                <a href={doc.href} target="_blank" rel="noreferrer">
                  {doc.title}
                </a>
                <p>{doc.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>
      ) : null}

      <main className="right-column">
        <header className="top-block panel compact">
          <div className="top-block-main">
            <div className="brand-header">
              <img src="/hal_logo.png" alt="HAL logo" className="hal-logo" />
              <div>
                <div className="brand-kicker">academy labs operator layer</div>
                <h1>HAL+</h1>
                <p>MCP-grounded answers, concise by default.</p>
              </div>
            </div>

            <div className="theme-switcher-inline" aria-label="Theme mode">
              {themeVersions.map((version) => (
                <a key={version.path} href={version.path} className={version.path === theme.path ? "active" : ""}>
                  {version.label}
                </a>
              ))}
            </div>
          </div>

          <div className="chip-row health-row">
            {healthChips.map((chip) => (
              <div
                key={chip.id}
                className={`health-chip ${chip.state} ${chip.kind ?? "runtime"} ${
                  chip.kind === "product" ? `product-${chip.product?.state || "unknown"}` : ""
                }`}
                title={chip.kind === "product" ? `${chip.product?.state || "unknown"} · ${chip.product?.endpoint || "no endpoint"}` : chip.detail}
              >
                <span className="status-dot" aria-hidden>
                  {chipDot(chip)}
                </span>
                {chip.kind === "product" && chip.product?.state === "running" && isHttpUrl(chip.product.endpoint) ? (
                  <a className="chip-link" href={chip.product.endpoint} target="_blank" rel="noreferrer" title={chip.product.endpoint}>
                    {chip.label}
                  </a>
                ) : (
                  <span>{chip.label}</span>
                )}
                {renderChipOverlay(chip)}
              </div>
            ))}
          </div>
        </header>

        <section className="chat-panel">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <p>Ask a question and HAL+ will answer with MCP-grounded commands first.</p>
              <div className="suggestion-row">
                {activeSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="suggestion-chip" onClick={() => setInput(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="chat-list">
              {messages.map((message) => (
                <li key={message.id} className={`chat-msg ${message.role}`}>
                  <div className="msg-head">
                    <strong>{message.role === "user" ? "You" : "HAL+"}</strong>
                    <span>{message.ts}</span>
                  </div>
                  {message.role === "assistant" && message.text.trim() === "" ? (
                    <div className="thinking-inline">HAL+ is grounding the answer...</div>
                  ) : (
                    <div className="msg-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <form ref={formRef} className="composer" onSubmit={submit}>
          <div className="composer-topline">
            <div>
              <span className="composer-label">Ask HAL+</span>
              <span className="composer-note">Suggestions are sampled across available products.</span>
            </div>
            <div className="suggestion-row compact-row">
              {activeSuggestions.slice(0, 3).map((suggestion) => (
                <button key={suggestion} type="button" className="suggestion-chip" onClick={() => setInput(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={activeSuggestions[0] || "Example: How do I deploy Vault in HAL?"}
            rows={3}
          />
          <div className="composer-actions">
            <button type="button" className="ghost" onClick={clearHistory}>
              Clear
            </button>
            <button type="submit" disabled={!input.trim() || isSending}>
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
