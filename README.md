# HAL Plus

HAL Plus is a local web UI layer for HAL (HashiCorp Academy Labs), with chat powered by Ollama and live status chips grounded through HAL MCP runtime tools.

## Stack
- React + Vite + TypeScript (frontend)
- Express (local API bridge)
- Ollama model backend (default: `gemma4`)

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Make sure Ollama is running and model is available:
   ```bash
   ollama pull gemma4
   ollama serve
   ```
3. Start the app (API + UI):
   ```bash
   npm run dev
   ```
4. Open:
   - http://hal.localhost:9000/
   - Dark mode: http://hal.localhost:9000/dark

## Build
```bash
npm run build
npm run preview
```

## Docker
Build locally:

```bash
docker build -t ghcr.io/hashimiche/hal-plus:local .
docker run --rm -p 9000:9000 ghcr.io/hashimiche/hal-plus:local
```

Published image (GitHub Container Registry):

- `ghcr.io/hashimiche/hal-plus:v*` from git tags
- `ghcr.io/hashimiche/hal-plus:latest` from git tags (`v*`)

GitHub Actions workflow:

- `.github/workflows/docker-validate.yml` (build + smoke test on PR/main)
- `.github/workflows/docker-publish.yml`
- publishes multi-arch images (`linux/amd64`, `linux/arm64`) to GHCR on `v*` tags

If `hal plus create` pulls this image without credentials, set the GHCR package visibility to public.

## Environment Variables
- `OLLAMA_BASE_URL` (optional explicit override)
- `OLLAMA_HOST_INTERNAL` (default host alias in container mode: `host.containers.internal`)
- `OLLAMA_MODEL` (default: `gemma4`)
- `OLLAMA_CONTEXT_WINDOW` (default: `32768`)
- `API_HOST` (default: `127.0.0.1`)
- `API_PORT` (default: `9001`)
- `HAL_PLUS_CONTAINER_MODE` (optional: force container-mode detection when set to `true`)
- `HAL_BINARY` (optional HAL CLI path used by server-side status and policy operations)
- `HAL_MCP_SERVER_CMD` (optional shell command for starting MCP stdio transport; if set, it overrides `hal mcp serve --transport stdio`)
- `HAL_MCP_HTTP_URL` (optional HTTP MCP endpoint; when set, hal-plus uses HTTP transport instead of spawning local stdio MCP)

OLLAMA URL resolution behavior:
- Host mode (for example `npm run dev`): defaults to `http://127.0.0.1:11434`
- Container mode: defaults to `http://host.containers.internal:11434`
- Explicit `OLLAMA_BASE_URL` always wins

### Container runtime pattern (host Ollama + HTTP MCP)

For rootless Podman and similar environments, keep Ollama on the host and point `hal-plus` to host Ollama from inside the container.
When possible, prefer MCP HTTP transport from containerized `hal-plus` to containerized MCP services on the same `hal-net` network.

Example:

```bash
docker run --rm -p 9000:9000 \
   -e API_HOST=0.0.0.0 \
   -e API_PORT=9000 \
   -e OLLAMA_BASE_URL=http://host.containers.internal:11434 \
   -e HAL_MCP_HTTP_URL=http://hal-mcp:8080/mcp \
   --network hal-net \
   ghcr.io/hashimiche/hal-plus:latest
```

When `HAL_MCP_HTTP_URL` is set, hal-plus does not spawn `hal mcp serve`; it calls MCP JSON-RPC over HTTP.

## Current Behavior
- Chat streams responses from Ollama in real time.
- Assistant messages render markdown, links, and code blocks.
- Product chips are loaded by default with no-data/offline state, then updated from live HAL status.
- Running products with HTTP endpoints are clickable directly from the chip label.

## Project Notes
- UX contract: `UX_PARITY.md`
- Product/design intent: `design.md`
- LLM behavior contract: `LLM_BEHAVIOR.md`
