# UX Parity Specification (Hashi Lens v1 to v2)

Purpose
- Preserve the current user experience while allowing a full backend rewrite.
- Keep this file as a contract for the next repo.

## 1. Product Shape
- Single-page operations assistant for HAL and HashiCorp workflows.
- Chat-first interface with visible execution telemetry and documentation suggestions.
- Information-dense dashboard layout, not a plain chatbot.

## 2. Canonical Layout
- Two-column workspace.
- Left column contains:
  - Execution Feed (recent tool calls, status, duration, errors)
  - Proposed Docs panel (contextual links from assistant flow)
- Right column contains:
  - Unified top block containing:
    - Theme mode switch (Light/Dark)
    - Header and branding (logo, name, tagline)
    - Runtime and product status chips
  - Chat timeline
  - Prompt composer

Host and route convention
- App URL should run on `hal.localhost:9000`.
- Theme routes:
  - Light mode on `/`
  - Dark mode on `/dark`

Responsive behavior
- Desktop: two-column layout.
- Tablet/mobile: stacked layout with left column panels above chat.

## 3. Core UI Regions

### A. Execution Feed (left panel)
- Collapsible panel.
- Shows recent tool calls only (last handful), with fade for older items.
- Tool type icon and status styling:
  - running
  - success
  - error
- Supports frequent refresh for near-real-time feel.

### B. Proposed Docs (left panel)
- Collapsible panel.
- Displays suggested documentation cards:
  - title
  - description
  - optional context
  - external link
- Empty state text when no suggestions are available.

### C. Header and Status Row (right panel)
- Branding row with logo, product name, subtitle/tagline.
- Theme switch and health chips are in the same compact top block as branding to maximize chat space.
- Status chips with hover detail popovers for:
  - Loki readiness
  - LLM runtime/model readiness
  - HAL MCP executable status
  - HAL product statuses (running/not deployed, endpoint, version, feature flags)
- Token context chip appears in the same status row.
- Runtime chips and product chips should be visually distinct but share one compact row contract.
- Product chips should follow Hashi Lens semantics: label = product name, popover = endpoint + state + version + feature flags.
- Optional readiness banners for startup hints.

### D. Chat Timeline
- Message list with timestamps and role presentation.
- Assistant markdown rendering.
- Streaming text updates for assistant responses.
- Placeholder animation while waiting for streamed text.
- Inline error message cards for failed requests.
- Auto-scroll pause behavior with jump-to-latest control.

### E. Prompt Composer
- Multi-line text input.
- Enter sends.
- Shift + Enter creates newline.
- Action buttons:
  - Send
  - Clear History

## 4. Interaction Modes
- Landing mode:
  - Larger header and branding before first user prompt.
- Compact mode:
  - Header condenses after first user message.
- Must transition automatically based on conversation state.

## 5. Live Data and Refresh Cadence
Target polling frequencies to preserve current behavior:
- Execution feed: 1 second
- Proposed docs: 2 seconds
- Auth quick status checks: frequent (seconds-level in app shell)
- Runtime info: around 15 seconds
- HAL status: around 12 seconds
- Token usage: around 5 seconds

Note
- Exact intervals can vary slightly if needed for performance, but perceived responsiveness should remain equivalent.

## 6. Required UX States
Must-have visible states:
- Global auth loading overlay with phase message.
- No-docs empty state.
- Streaming in-progress assistant state.
- Inline error state in chat timeline.
- Status chip warning/ok indicators.
- Collapsed and expanded panel states.
- Token usage severity:
  - safe
  - warning
  - critical

## 7. Visual Style Contract
- Neutral console look inspired by VS Code themes.
- Rounded cards and pill chips.
- Subtle shadows and clear panel separation.
- Dense but readable typography and spacing.
- Exactly two theme modes in current scope: Light and Dark.
- Light mode should follow VS Code light palette direction (clean white/gray surfaces, blue accent).
- Dark mode should follow VS Code dark palette direction (editor-like dark surfaces, blue accent).
- Dark mode support via CSS variables/theme tokens.

## 8. Backend-Independent UX Contract
The frontend experience must keep these capabilities regardless of backend tech stack:
- Session-scoped chat history.
- Streaming assistant responses.
- Tool activity timeline source.
- Documentation suggestions source.
- Runtime status source.
- HAL status source.
- Token context source.
- Authentication status and login/logout/switch flows.
- Clear history and clear suggestions actions.

## 9. Acceptance Checklist for v2
- Two-column layout parity achieved on desktop.
- Mobile/tablet stacking behavior implemented.
- Landing-to-compact transition implemented.
- Streaming message rendering implemented.
- Execution feed matches v1 behavior and semantics.
- Proposed docs panel matches v1 behavior and semantics.
- Status chips and popovers implemented.
- Token usage indicator implemented with severity tiers.
- Auth loading overlay implemented.
- Polling/live refresh behavior feels equivalent.
- Inline error handling behavior matches v1.

## 10. Nice-to-Have (Optional)
- Move from polling to server push where feasible.
- Preserve exact visual token names to simplify theme migration.
- Add screenshot-based regression checks for key states.
