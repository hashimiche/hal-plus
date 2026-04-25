# HAL Plus — Answer Quality Contract

Branch: `feature/improve-answer-quality`
Status: in-progress

---

## Purpose

This document is the source of truth for how HAL Plus should route and format answers.
It governs `deterministic-engine.mjs`, `policy-engine.mjs`, and behavior file `body` content.
Any LLM working on this codebase must read this before touching answer flow code.

---

## Three Intent Routes

Every incoming prompt must be classified into one of three routes before any response is built.

### Route A — Knowledge / Factual

**Trigger:** The user is asking a conceptual or prerequisite question.

Detection patterns (`isKnowledgeQuestion`):
- "does X need", "is X required", "do I need", "what does X need"
- "is X enterprise", "does X need a license", "is X free"
- "why does X", "what is X", "what's the difference"
- "how does X work" (without "configure", "enable", "setup", "code", "api" nearby)

**Output format:**

```
<2–3 sentence factual prose answer. Direct. Educational tone. No command dumps.>

```shell
<one key command only — the single most relevant HAL command, if any>
```

<one doc link — the deepest, most specific doc available for the question>
```

**Rules:**
- No Preflight / Run / Check / Verify sections.
- No runtime MCP baseline needed (factual answers are stable knowledge, not runtime state).
- If the answer has a licensing nuance (e.g. TFE needs a license, CSI needs Enterprise), state it clearly and attach the relevant license/edition doc.
- One command maximum. If zero commands are relevant, omit the code block entirely.

**Example:**

> Q: Does the HAL TFE lab need a license?
>
> A: Yes — Terraform Enterprise is an enterprise product and requires a valid license string before it can start. Set it with `export TFE_LICENSE='<your_license_string>'` before running `hal terraform create`. You can also deploy a second TFE instance with `hal terraform create --twin` if you want to test multi-instance federation.
>
> [Terraform Enterprise licensing →](https://developer.hashicorp.com/terraform/enterprise/deploy/reference-architecture)

---

### Route B — Operational / Deploy / Configure

**Trigger:** The user wants to run, deploy, enable, or configure something.

Detection: existing `isOperationalPrompt()` — keep as-is.

**Output format (current — keep):**

```
Preflight:
```shell
<status check command>
```

Run:
```shell
<action commands>
```

Check:
```shell
<status commands>
```

Verify:
```shell
<verify commands>
```

Docs: <link>

Tips:
- <note>
```

**New addition for Route B — "Under the Hood" expansion:**

When the prompt contains a code/internals signal (`isCodeIntent`), append a `## Under the hood` section after the Tips block. This section comes from the behavior file `body` field (static markdown authored in `llm/products/**/*.md`).

Code intent detection patterns (`isCodeIntent`):
- "give me the code", "show me the config", "what's the api", "api call", "cli command", "raw command"
- "how does it work", "what happens under the hood", "what does hal do", "internals"
- "configure", "configuration" when paired with "code", "snippet", "block", "example"

When `isCodeIntent` is true AND the matched behavior's `body` is non-empty:
- Append the body verbatim after the Tips/Notes section, under the heading `## Under the hood`
- Remove the model supplement "2-3 lines max" cap in the system prompt — allow the model to emit full code blocks
- The model should use the body content + official docs as grounding, not hallucinate

When `isCodeIntent` is false:
- Do not append body
- Keep the "brief supplement" cap (2-3 lines) to avoid noise

**Example:**

> Q: Give me the code to enable kubernetes auth engine on Vault and its configuration
>
> A: [Preflight/Run/Check/Verify blocks as today]
>
> ## Under the hood
>
> ```shell
> # Enable the auth method
> vault auth enable kubernetes
>
> # Configure it — point to the K8s API and provide the cluster's CA cert
> vault write auth/kubernetes/config \
>   kubernetes_host="https://$(kubectl get svc kubernetes -o jsonpath='{.spec.clusterIP}'):443" \
>   kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
>   token_reviewer_jwt="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
>
> # Create a role mapping a service account to a Vault policy
> vault write auth/kubernetes/role/app1-role \
>   bound_service_account_names=app1 \
>   bound_service_account_namespaces=app1 \
>   policies=app1-policy \
>   ttl=24h
> ```
>
> [Vault Kubernetes Auth docs →](https://developer.hashicorp.com/vault/docs/auth/kubernetes)

---

### Route C — Follow-up / Contextual

**Trigger:** The prompt is short, contextual, and does not clearly match any behavior spec.

Examples: "on a different path?", "what about CSI?", "and for enterprise?", "can I do the same for Nomad?"

Detection: no behavior match AND prompt is short (< 60 chars) OR prompt starts with "and", "what about", "how about", "on a", "same for"

**Behavior:**
- Skip deterministic output entirely
- Forward the last matched behavior's `id` and `body` as grounding context to the model
- System prompt injection: "The user is following up on [behaviorId]. Relevant context: [body snippet]"
- Model answers freely with that grounding — no forced structure

**Implementation note:** Requires tracking `lastMatchedBehaviorId` in the per-request context. The value is set when a deterministic route matches, and carried into the fallback model path for the same session/conversation turn.

---

## Behavior File Body Contract

Every file in `llm/products/**/*.md` has two parts:

1. **Spec block** (`<!-- hal-plus-spec ... -->`) — machine-readable JSON consumed by `behavior-registry.mjs`
2. **Body** — human/LLM-readable markdown below the spec block, consumed by the `isCodeIntent` expansion path

Body authoring rules:
- Write vault/consul/nomad/TFE CLI and/or API commands that configure the feature the spec covers
- Use real commands from official docs — no invented flags
- Include both the `vault` CLI form and the HTTP API `curl` form when both are practical
- Group with `###` subheadings if multiple phases exist (enable / configure / verify)
- Keep it educational: brief comment on each command block explaining *why*, not just *what*
- Length: 20–80 lines is the target range; do not pad

**Files that need body content written (Step 4 of the plan):**
- `vault/k8s.md` — kubernetes auth method (vault CLI + API)
- `vault/database.md` — database secrets engine
- `vault/jwt.md` — JWT auth method config
- `vault/ldap.md` — LDAP auth method config
- `vault/oidc.md` — OIDC auth method
- `vault/audit.md` — audit device enable/list
- `terraform-enterprise/deploy.md` — TFE license context, API health check, initial admin bootstrap

---

## Model Supplement Policy

Defined in `policy-engine.mjs` `buildSystemPrompt()`.

| Intent | Model supplement cap | Code blocks allowed |
|---|---|---|
| Knowledge (Route A) | none — model fills prose | no (prose only) |
| Operational, no code intent | 2-3 lines max (current) | no |
| Operational + `isCodeIntent` | unlimited | yes — full blocks |
| Follow-up (Route C) | unlimited | yes |
| Status question | 0 — deterministic only | no |

---

## What Must Never Happen

- A factual yes/no question must not produce a Preflight/Run/Check/Verify dump.
- Body content must never appear in status answers.
- The model must never fabricate vault/consul/nomad commands — if `isCodeIntent` is true and the body is empty, omit the "Under the hood" section entirely rather than letting the model invent commands.
- A follow-up question must never produce a blank or repeated-previous answer.
