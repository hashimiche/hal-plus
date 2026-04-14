import { spawn } from "node:child_process";

const MCP_PROTOCOL_VERSION = "2024-11-05";

function frameMessage(message) {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
}

function extractFramedMessages(buffer) {
  const messages = [];
  let remaining = buffer;

  while (true) {
    const headerEnd = remaining.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }

    const header = remaining.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error("HAL MCP returned an invalid frame header.");
    }

    const contentLength = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (remaining.length < messageEnd) {
      break;
    }

    messages.push(remaining.slice(messageStart, messageEnd));
    remaining = remaining.slice(messageEnd);
  }

  return { messages, remaining };
}

function createTimeout(label, timeoutMs) {
  let timer = null;

  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  return {
    promise,
    clear() {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

export function createHalMcpClient(resolveHalExecutable, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10000);

  return {
    async callTool(name, args = {}) {
      const halExecutable = await resolveHalExecutable();

      return new Promise((resolve, reject) => {
        const child = spawn(halExecutable, ["mcp", "up", "--transport", "stdio"], {
          stdio: ["pipe", "pipe", "pipe"]
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";
        let settled = false;
        let nextId = 1;
        const pending = new Map();
        const globalTimeout = createTimeout(`HAL MCP tool ${name}`, timeoutMs);

        function settle(handler, value) {
          if (settled) {
            return;
          }

          settled = true;
          globalTimeout.clear();
          for (const pendingRequest of pending.values()) {
            pendingRequest.reject(new Error(`HAL MCP request cancelled while calling ${name}.`));
          }
          pending.clear();
          child.kill();
          handler(value);
        }

        function send(method, params, expectResponse = true) {
          const id = nextId;
          if (expectResponse) {
            nextId += 1;
          }

          const message = {
            jsonrpc: "2.0",
            method,
            ...(expectResponse ? { id } : {}),
            ...(params ? { params } : {})
          };

          if (expectResponse) {
            const requestPromise = new Promise((requestResolve, requestReject) => {
              pending.set(id, { resolve: requestResolve, reject: requestReject });
            });
            child.stdin.write(frameMessage(message));
            return requestPromise;
          }

          child.stdin.write(frameMessage(message));
          return Promise.resolve(null);
        }

        function handleRpcMessage(rawMessage) {
          let parsed;
          try {
            parsed = JSON.parse(rawMessage);
          } catch (error) {
            settle(reject, error instanceof Error ? error : new Error("HAL MCP returned invalid JSON."));
            return;
          }

          if (Object.prototype.hasOwnProperty.call(parsed, "id") && pending.has(parsed.id)) {
            const request = pending.get(parsed.id);
            pending.delete(parsed.id);
            if (parsed.error) {
              request.reject(new Error(parsed.error.message || `HAL MCP request ${parsed.id} failed.`));
              return;
            }
            request.resolve(parsed.result);
          }
        }

        child.stdout.on("data", (chunk) => {
          try {
            stdoutBuffer += chunk.toString("utf8");
            const parsed = extractFramedMessages(stdoutBuffer);
            stdoutBuffer = parsed.remaining;
            for (const message of parsed.messages) {
              handleRpcMessage(message);
            }
          } catch (error) {
            settle(reject, error instanceof Error ? error : new Error("HAL MCP stdout parsing failed."));
          }
        });

        child.stderr.on("data", (chunk) => {
          stderrBuffer += chunk.toString("utf8");
        });

        child.on("error", (error) => {
          settle(reject, error);
        });

        child.on("exit", (code) => {
          if (!settled && pending.size > 0) {
            const stderrText = stderrBuffer.trim();
            settle(reject, new Error(stderrText || `HAL MCP exited with code ${code ?? "unknown"}.`));
          }
        });

        Promise.race([
          (async () => {
            await send("initialize", {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "hal-plus", version: "0.1.0" }
            });

            await send("notifications/initialized", {}, false);
            const toolResult = await send("tools/call", {
              name,
              arguments: args
            });

            settle(resolve, {
              content: Array.isArray(toolResult?.content) ? toolResult.content : [],
              isError: Boolean(toolResult?.isError),
              structuredContent: toolResult?.structuredContent || null
            });
          })(),
          globalTimeout.promise
        ]).catch((error) => {
          settle(reject, error instanceof Error ? error : new Error(`HAL MCP call ${name} failed.`));
        });
      });
    }
  };
}
