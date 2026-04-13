# HAL Plus

HAL Plus is a local web UI layer for HAL (HashiCorp Academy Labs), with chat powered by Ollama and live status chips based on real `hal status` output.

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

## Environment Variables
- `OLLAMA_BASE_URL` (default: `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` (default: `gemma4`)
- `OLLAMA_CONTEXT_WINDOW` (default: `32768`)
- `API_HOST` (default: `127.0.0.1`)
- `API_PORT` (default: `9001`)

## Current Behavior
- Chat streams responses from Ollama in real time.
- Assistant messages render markdown, links, and code blocks.
- Product chips are loaded by default with no-data/offline state, then updated from live HAL status.
- Running products with HTTP endpoints are clickable directly from the chip label.

## Project Notes
- UX contract: `UX_PARITY.md`
- Product/design intent: `design.md`
- LLM behavior contract: `LLM_BEHAVIOR.md`
