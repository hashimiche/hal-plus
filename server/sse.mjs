export function streamSSEText(res, text) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  res.end();
}

export async function streamSSESections(res, text, options = {}) {
  const delayMs = Number(options.delayMs || 70);
  const sections = String(text || "")
    .split(/\n\n+/)
    .map((section) => section.trim())
    .filter(Boolean);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for (let index = 0; index < sections.length; index += 1) {
    const suffix = index < sections.length - 1 ? "\n\n" : "";
    res.write(`data: ${JSON.stringify({ type: "chunk", content: sections[index] + suffix })}\n\n`);
    if (delayMs > 0 && index < sections.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  res.end();
}

export async function proxyOllamaStreamToSSE(res, ollamaResponse) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const chunk = parsed?.message?.content || "";
      if (chunk) {
        res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
      }

      if (parsed?.done) {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        return;
      }
    }
  }

  res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  res.end();
}
