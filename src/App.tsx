import {
  ComponentPropsWithoutRef,
  FormEvent,
  KeyboardEvent,
  ReactElement,
  ReactNode,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
  ts: string;
  source?: "hybrid" | "model";
  mcpServer?: string;
  behaviorTopic?: string;
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
    llm: { ok: boolean; detail: string; model?: string; runtimeModel?: string; contextWindow?: number; keepAlive?: string };
    halMcp: { ok: boolean; detail: string; missingTools?: string[]; url?: string };
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

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
};

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  children?: ReactNode;
  mcpGrounded?: boolean;
  mcpServer?: string;
  behaviorTopic?: string;
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

function seededScore(value: string, seed: number): number {
  let hash = seed || 1;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

function loadingVerbForMessageId(messageId: string): string {
  const verbs = ["thinking", "analyzing", "grounding", "reasoning", "processing"];
  if (!messageId) {
    return verbs[0];
  }

  let hash = 0;
  for (let i = 0; i < messageId.length; i += 1) {
    hash = (hash * 31 + messageId.charCodeAt(i)) % 2147483647;
  }

  return verbs[Math.abs(hash) % verbs.length];
}

function MarkdownCodeBlock({ inline, className, children, ...props }: MarkdownCodeProps) {
  if (inline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractText(item)).join("");
  }
  if (isValidElement(node)) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function MarkdownPreBlock({ children, mcpGrounded, mcpServer, behaviorTopic, ...props }: MarkdownPreProps) {
  const [copied, setCopied] = useState(false);
  const rawText = extractText(children).replace(/\n$/, "");

  let codeClassName = "";
  if (isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    codeClassName = String(child.props.className || "");
  }

  const handleCopy = async () => {
    if (!rawText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Ignore clipboard errors and keep the code block readable.
    }
  };

  return (
    <div className={`code-block-wrap${mcpGrounded ? " mcp-grounded" : ""}`}>
      {mcpGrounded && (
        <span className="mcp-source-chips" aria-label="MCP grounded">
          <span className="mcp-source-chip">
            MCP
            <span className="mcp-source-tooltip">MCP-grounded — commands sourced from live runtime</span>
          </span>
          {mcpServer && (
            <span className="mcp-server-chip">{mcpServer}</span>
          )}
        </span>
      )}
      <button type="button" className="code-copy-btn" onClick={handleCopy} aria-label="Copy code block">
        <span className="copy-icon" aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
      <pre {...props}>
        <code className={codeClassName}>{rawText}</code>
      </pre>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [catalog, setCatalog] = useState<BehaviorCatalog | null>(null);
  const [suggestionSeed, setSuggestionSeed] = useState(() => Math.floor(Math.random() * 100000));
  const formRef = useRef<HTMLFormElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const activeChatRequestRef = useRef<AbortController | null>(null);
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
    const panel = chatPanelRef.current;
    if (!panel) {
      return;
    }

    panel.scrollTop = panel.scrollHeight;
  }, [messages]);

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

  const followUpSuggestionsByAssistantId = useMemo(() => {
    const products = catalog?.products || [];
    const result: Record<string, string[]> = {};

    const suggestionsForPrompt = (prompt: string): string[] => {
      const normalizedPrompt = String(prompt || "").trim();
      if (!normalizedPrompt) {
        return activeSuggestions.slice(0, 3);
      }

      if (products.length === 0) {
        return activeSuggestions.slice(0, 3);
      }

      const scoredProducts = products
        .map((product) => ({
          product,
          score:
            scoreTerms(normalizedPrompt, product.matchTerms) +
            product.subcommands.reduce((total, subcommand) => total + scoreTerms(normalizedPrompt, subcommand.matchTerms), 0)
        }))
        .sort((left, right) => right.score - left.score);

      const targetProduct =
        (scoredProducts[0] && scoredProducts[0].score > 0 ? scoredProducts[0].product : activeCatalogProduct) || products[0];

      const relevantSubcommands = targetProduct.subcommands.filter((subcommand) =>
        scoreTerms(normalizedPrompt, subcommand.matchTerms) > 0
      );

      const rawPool = [
        ...(targetProduct.samplePrompts || []),
        ...(relevantSubcommands.length > 0
          ? relevantSubcommands.flatMap((subcommand) => subcommand.samplePrompts || [])
          : targetProduct.subcommands.flatMap((subcommand) => subcommand.samplePrompts || []))
      ];

      const suggestions = uniqueStrings(rawPool).filter(
        (candidate) => candidate.toLowerCase() !== normalizedPrompt.toLowerCase()
      );

      if (suggestions.length > 0) {
        return suggestions.slice(0, 3);
      }

      return activeSuggestions.slice(0, 3);
    };

    let previousUserPrompt = "";
    for (const message of messages) {
      if (message.role === "user") {
        previousUserPrompt = message.text;
        continue;
      }

      if (message.role === "assistant" && message.text.trim()) {
        result[message.id] = suggestionsForPrompt(previousUserPrompt);
      }
    }

    return result;
  }, [activeCatalogProduct, activeSuggestions, catalog?.products, messages]);


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
      const features = chip.product.features;
      return (
        <div className="chip-overlay product-overlay" role="presentation">
          <div className="chip-overlay-head product-overlay-head">
            <strong>{chip.product.name}</strong>
            <span>{chip.product.state}</span>
          </div>
          {chip.product.version && chip.product.version !== "n/a" && chip.product.version !== "-" ? (
            <p>{chip.product.version}</p>
          ) : null}
          {features.length > 0 ? (
            <div className="chip-overlay-features">
              {features.map((feature) => {
                const colonIdx = feature.indexOf(":");
                const key = colonIdx >= 0 ? feature.slice(0, colonIdx) : feature;
                const value = colonIdx >= 0 ? feature.slice(colonIdx + 1) : "";
                const enabled = value.toLowerCase() === "enabled";
                return (
                  <span key={feature} className={`feature-row ${enabled ? "feature-enabled" : "feature-disabled"}`}>
                    <span className="feature-dot" aria-hidden>●</span>
                    {key}
                  </span>
                );
              })}
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
            {liveStatus?.runtime.llm.keepAlive ? <span>{`idle unload ${liveStatus.runtime.llm.keepAlive}`}</span> : null}
          </div>
        </div>
      );
    }

    if (chip.id === "hal-mcp") {
      const missingTools = liveStatus?.runtime.halMcp.missingTools || [];
      return (
        <div className="chip-overlay runtime-overlay" role="presentation">
          <div className="chip-overlay-head">
            <strong>HAL MCP</strong>
            <span>{chip.state === "ok" ? "ready" : "degraded"}</span>
          </div>
          <p>{chip.detail}</p>
          {missingTools.length > 0 ? (
            <div className="chip-overlay-tags">
              {missingTools.map((toolName) => (
                <span key={toolName}>{toolName} missing</span>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    return null;
  };

  const sendPrompt = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
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
    const requestController = new AbortController();
    activeChatRequestRef.current = requestController;

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
        body: JSON.stringify({ messages: conversation }),
        signal: requestController.signal
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
          const payload = JSON.parse(payloadRaw) as { type: string; content?: string; message?: string; source?: string; mcpServer?: string; topic?: string };

          if (payload.type === "meta" && payload.source) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, source: payload.source as Message["source"], mcpServer: payload.mcpServer ?? undefined, behaviorTopic: payload.topic ?? undefined } : message
              )
            );
          }

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
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((prev) =>
          prev.map((entry) => (entry.id === assistantId ? { ...entry, text: "Generation stopped." } : entry))
        );
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantId ? { ...entry, text: `Error while contacting Ollama:\n\n${message}` } : entry
        )
      );
    } finally {
      if (activeChatRequestRef.current === requestController) {
        activeChatRequestRef.current = null;
      }
      setIsSending(false);
    }
  };

  const stopStreaming = () => {
    activeChatRequestRef.current?.abort();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendPrompt(input);
  };

  const clearHistory = () => {
    activeChatRequestRef.current?.abort();
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
    <div className={`app-shell ${theme.className} no-docs`}>

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

        <section ref={chatPanelRef} className="chat-panel">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <p>Ask a question and HAL+ will answer with MCP-grounded commands first.</p>
              <div className="suggestion-row">
                {activeSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="suggestion-chip" onClick={() => void sendPrompt(suggestion)}>
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
                    <div className="thinking-inline">
                      <span>{loadingVerbForMessageId(message.id)}</span>
                      <span className="thinking-dots" aria-hidden>
                        ...
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="msg-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code: MarkdownCodeBlock,
                            pre: message.source === "hybrid"
                              ? (preProps) => <MarkdownPreBlock {...preProps} mcpGrounded mcpServer={message.mcpServer} behaviorTopic={message.behaviorTopic} />
                              : MarkdownPreBlock
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>
                      {message.role === "assistant" && followUpSuggestionsByAssistantId[message.id]?.length ? (
                        <div className="followup-row">
                          {followUpSuggestionsByAssistantId[message.id].map((suggestion) => (
                            <button
                              key={`${message.id}-${suggestion}`}
                              type="button"
                              className="suggestion-chip followup-chip"
                              onClick={() => void sendPrompt(suggestion)}
                              disabled={isSending}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <form ref={formRef} className="composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Question for HAL+"
            rows={3}
          />
          <div className="composer-actions">
            {isSending ? (
              <button type="button" className="ghost stop-btn" onClick={stopStreaming}>
                Stop
              </button>
            ) : null}
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
