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

type FeedItem = {
  id: string;
  label: string;
  status: "running" | "success" | "error";
  duration: string;
};

const initialFeed: FeedItem[] = [
  { id: "1", label: "hal status", status: "success", duration: "210ms" },
  { id: "2", label: "vault health", status: "running", duration: "-" },
  { id: "3", label: "docs suggest", status: "success", duration: "48ms" }
];

const initialDocs = [
  {
    title: "HAL CLI Repository",
    description: "Reference commands and workflows used by the HAL interface.",
    href: "https://github.com/hashimiche/hal"
  },
  {
    title: "Vault Secrets Operator (VSO)",
    description: "Official VSO docs, including deployment and Kubernetes integration.",
    href: "https://developer.hashicorp.com/vault/docs/platform/k8s/vso"
  },
  {
    title: "Vault CSI Provider",
    description: "Official guide for Vault CSI provider and required prerequisites.",
    href: "https://developer.hashicorp.com/vault/docs/platform/k8s/csi"
  }
];

type ThemeVersion = {
  className: string;
  label: string;
  path: string;
};

type HealthState = "ok" | "warn" | "neutral";

type HealthChip = {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  kind?: "runtime" | "product";
  product?: HalProduct;
};

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

const themeVersions: ThemeVersion[] = [
  { className: "theme-light", label: "Light", path: "/" },
  { className: "theme-dark", label: "Dark", path: "/dark" }
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const theme = getThemeFromPath(window.location.pathname);

  const compact = messages.length > 0;

  const runtimeLabel = useMemo(() => (isSending ? "LLM: streaming" : "LLM: ready"), [isSending]);

  const estimatedTokens = useMemo(() => {
    const chars = messages.reduce((sum, msg) => sum + msg.text.length, 0) + input.length;
    return Math.max(0, Math.ceil(chars / 4));
  }, [input.length, messages]);

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

    void fetchStatus();
    const interval = window.setInterval(fetchStatus, 12000);
    return () => window.clearInterval(interval);
  }, []);

  const healthChips: HealthChip[] = useMemo(
    () => {
      const runtimeChips: HealthChip[] = [
        {
          id: "loki",
          label: "Loki",
          state: liveStatus ? (liveStatus.runtime.loki.ok ? "ok" : "neutral") : "neutral",
          detail: liveStatus?.runtime.loki.detail || "offline / no data",
          kind: "runtime"
        },
        {
          id: "llm",
          label: runtimeLabel,
          state: isSending ? "warn" : liveStatus ? (liveStatus.runtime.llm.ok ? "ok" : "neutral") : "neutral",
          detail: liveStatus?.runtime.llm.detail || "offline / no data",
          kind: "runtime"
        },
        {
          id: "hal-mcp",
          label: "HAL MCP",
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
    [contextWindow, displayProducts, estimatedTokens, isSending, liveStatus, runtimeLabel, tokenPercent, tokenState]
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
      const conversation = [...messages, userMessage].map((m) => ({ role: m.role, content: m.text }));
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
          const payloadLine = evt
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!payloadLine) {
            continue;
          }

          const payloadRaw = payloadLine.replace(/^data:\s*/, "");
          const payload = JSON.parse(payloadRaw) as { type: string; content?: string; message?: string };

          if (payload.type === "chunk" && payload.content) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, text: msg.text + payload.content } : msg
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
        prev.map((msg) =>
          msg.id === assistantId ? { ...msg, text: `Error while contacting Ollama:\n\n${message}` } : msg
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
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <div className={`app-shell ${theme.className}`}>
      <aside className="left-column">
        <section className="panel">
          <header className="panel-header">
            <h2>Execution Feed</h2>
          </header>
          <ul className="feed-list">
            {initialFeed.map((item) => (
              <li key={item.id} className={`feed-item status-${item.status}`}>
                <span className="feed-label">{item.label}</span>
                <span className="feed-meta">{item.duration}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>Proposed Docs</h2>
          </header>
          <ul className="docs-list">
            {initialDocs.map((doc) => (
              <li key={doc.href} className="doc-card">
                <a href={doc.href} target="_blank" rel="noreferrer">
                  {doc.title}
                </a>
                <p>{doc.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="right-column">
        <header className={`top-block panel ${compact ? "compact" : "landing"}`}>
          <div className="top-block-main">
            <div className="brand-header">
              <img src="/hal_logo.png" alt="HAL logo" className="hal-logo" />
              <div>
                <h1>HAL Plus</h1>
                <p>HashiCorp Academy Labs AI layer</p>
              </div>
            </div>

            <div className="theme-switcher-inline" aria-label="Theme mode">
              {themeVersions.map((version) => (
                <a
                  key={version.path}
                  href={version.path}
                  className={version.path === theme.path ? "active" : ""}
                >
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
              >
                <span className="status-dot" aria-hidden>
                  {chipDot(chip)}
                </span>
                {chip.kind === "product" && chip.product?.state === "running" && isHttpUrl(chip.product.endpoint) ? (
                  <a
                    className="chip-link"
                    href={chip.product.endpoint}
                    target="_blank"
                    rel="noreferrer"
                    title={chip.product.endpoint}
                  >
                    {chip.label}
                  </a>
                ) : (
                  <span>{chip.label}</span>
                )}
                <span className="health-chip-popover">
                  {chip.kind === "product" && chip.product ? (
                    <span className="popover-grid">
                      <span className={`popover-state ${chip.product.state}`}>
                        {chip.product.state === "running" ? "● deployed" : chip.product.state === "not-deployed" ? "○ not deployed" : "◌ no data"}
                      </span>
                      <span>endpoint: {chip.product.endpoint || "no data"}</span>
                      <span>
                        version: {chip.product.version && chip.product.version !== "-" ? chip.product.version : "unknown"}
                      </span>
                      <span>features:</span>
                      {chip.product.features.length > 0 ? (
                        chip.product.features.map((feature) => (
                          <span key={`${chip.id}-${feature}`} className="popover-feature">
                            {feature}
                          </span>
                        ))
                      ) : (
                        <span className="popover-feature">- no data</span>
                      )}
                    </span>
                  ) : (
                    chip.detail
                  )}
                </span>
              </div>
            ))}
          </div>
        </header>

        <section className="chat-panel">
          {messages.length === 0 ? (
            <div className="empty-chat">
              Ask about a lab workflow and HAL will propose commands + official docs.
            </div>
          ) : (
            <ul className="chat-list">
              {messages.map((message) => (
                <li key={message.id} className={`chat-msg ${message.role}`}>
                  <div className="msg-head">
                    <strong>{message.role === "user" ? "You" : "HAL"}</strong>
                    <span>{message.ts}</span>
                  </div>
                  {message.role === "assistant" && message.text.trim() === "" ? (
                    <div className="thinking-inline">HAL is thinking...</div>
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
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Example: I want to setup VSO with CSI"
            rows={3}
          />
          <div className="composer-actions">
            <button type="button" className="ghost" onClick={clearHistory}>
              Clear History
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
