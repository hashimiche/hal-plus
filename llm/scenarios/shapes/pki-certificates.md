<!-- hal-plus-scenario
{
  "id": "pki-certificates",
  "title": "Vault as a private CA (PKI) with automated certificate issuance",
  "priority": 88,
  "intent": {
    "any": [
      "vault pki",
      "vault as a ca",
      "vault as a certificate authority",
      "private ca",
      "private certificate authority",
      "set up a certificate authority",
      "issue certificates",
      "issue a certificate",
      "issue tls certificates",
      "certificate authority with vault",
      "intermediate ca",
      "root and intermediate ca",
      "sign certificates with vault",
      "auto-renew certificates",
      "automatic certificate renewal",
      "rotate certificates automatically",
      "short-lived certificates",
      "cert-manager",
      "cert manager with vault",
      "leaf certificates for my pods",
      "tls certs for my pods",
      "acme with vault",
      "vault acme",
      "caddy acme vault",
      "lets encrypt style renewal"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "vault_pki",
  "slots": [
    { "name": "overview",        "source": "model+corpus" },
    { "name": "provision",       "source": "graph.action(dependsOn-walk)" },
    { "name": "access",          "source": "mcp.statusTool(access.surfaces+credentials)" },
    { "name": "trigger",         "source": "graph.manualTrigger" },
    { "name": "observe",         "source": "mcp.statusTool(observable.linkFrom)" },
    { "name": "tradeoffs",       "source": "graph.notes+corpus", "compare": ["acme", "k8s"] },
    { "name": "under_the_hood",  "source": "corpus", "coverage": ["docs", "tutorial", "validated-design", "video"], "citePerComponent": true },
    { "name": "learn_more",      "source": "corpus.cards(group_by=source_type)" }
  ],
  "grounding": {
    "commandsFrom": ["graph", "mcp"],
    "linksFrom": ["mcp", "corpus"],
    "liveFactsFrom": ["mcp"],
    "prose": "model-owned (verbatim constraint loosened for this route)"
  }
}
-->

# Scenario shape: Vault as a private CA (PKI) with automated certificate issuance

An **issue-and-rotate** exemplar: Vault becomes a private Certificate Authority. A **Root CA** signs an
**Intermediate CA**, and short-lived **leaf certificates** are minted on demand from the `hal-role` issuing
role — with the **private key generated and held inside Vault** (clients receive only the signed cert +
chain). The same 7 base slots apply, plus a dedicated **tradeoffs** slot because the natural follow-up here
is comparative: there are two optional automation layers on the same command — **ACME/Caddy** (`--acme`,
Let's-Encrypt-style auto-renewal) and **cert-manager on Kubernetes** (`--k8s`, leaf certs for a web pod).
"Trigger" is issuing (or auto-renewing) a certificate; "Observe" is the served cert being signed by the
Vault CA and rotating on its own.

Keep prose grounded: commands come from the capability graph (`{{primary.dependsOn}}` → `{{primary.action}}`),
the issue/renew step comes from `{{primary.manualTrigger}}`, and the CA hierarchy, role limits, ACME TTLs,
and cert-manager wiring come from the capability notes and corpus — never invented. Mandatory grounding
rules on this route:
1. **Private keys never leave Vault.** Issuance returns the signed certificate + chain only. Never describe
   the private key being exported or handed to the client.
2. **ACME certs are short-lived (5m) and auto-renew at ~1/3 lifetime.** Do not invent longer TTLs; the
   point of the demo is that you can *watch* the renewal happen live.
3. **`--k8s` leaf certs come from cert-manager via the Vault `ClusterIssuer`**, not minted directly by the
   app. Both demo layers need their tooling on PATH (`kind`/`kubectl`/`helm` for `--k8s`).

## Overview
Name the capability (`{{primary.label}}`) and the idea in a sentence or two: Vault holds a Root CA that
signs an Intermediate CA, and issues short-lived leaf certs from `hal-role` without ever releasing the
private key. Mention up front that the base command also enables an ACME endpoint, and that two optional
flags add working demos (`--acme` for auto-renewal, `--k8s` for cert-manager). Pull conceptual framing from
the corpus when available; otherwise summarize from `{{primary.provides}}`.

## Provision
List the commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`:

```bash
hal vault create                  # brings up Vault (capability: vault)
hal vault pki enable              # mounts Root + Intermediate CA, hal-role, ACME endpoint (capability: vault_pki)
# optional demo layers (additive):
hal vault pki enable --acme       # + Caddy pod that auto-renews a Vault-issued cert (Let's-Encrypt style)
hal vault pki enable --k8s        # + cert-manager ClusterIssuer issuing a leaf cert to an nginx web pod
```

Note that the base command mounts `pki-root` (Root CA, ~5y) and `pki-int` (Intermediate CA, ~2y), creates
the `hal-role` issuing role (allowed domains `hal.local,cluster.local,svc.cluster.local`, `max_ttl 24h`,
RSA 2048), and always wires the ACME endpoint. The `--k8s` layer needs `kind`/`kubectl`/`helm` on PATH.

## Access
Surface where the demos live: the **ACME/Caddy** demo at `https://acme.localhost:8090` (pod
`hal-caddy-acme`, namespace `pki-acme-demo`) and the **cert-manager** demo at `https://pki.localhost:8089`
(nginx pod `app=hal-web-pki`, namespace `pki-demo`, ClusterIssuer `vault-pki-issuer`, Certificate
`hal-web-pki-cert`). The CRL / issuing-cert URLs are published under
`http://vault.localhost:8200/v1/pki-int/...`. The status tool `get_vault_pki_status` returns text status
(engines / CA / role / cert-manager / ACME), not a structured payload, so describe these known facts rather
than a dotted path. Do not fabricate field paths.

## Trigger
State the issue/renew action from `{{primary.manualTrigger}}`. Manual issuance from the role:

```bash
vault write pki-int/issue/hal-role common_name="test.hal.local" ttl="24h"
```

With `--acme`, Caddy requests and **auto-renews** its certificate against Vault's built-in ACME directory
(role `acme-demo`, 5m TTL) at ~1/3 of the lifetime — no manual step. With `--k8s`, cert-manager issues and
rotates the `Certificate` for the web pod via the Vault `ClusterIssuer`.

## Observe
Describe the proof from `{{primary.observable.what}}`: a returned certificate + chain is signed by the
**Intermediate CA**, and the private key was generated inside Vault (never exported). In the `--acme` demo,
`https://acme.localhost:8090` serves a Vault-issued cert that visibly **auto-renews** on its short 5m
cycle; in the `--k8s` demo, `https://pki.localhost:8089` serves a cert-manager-issued leaf cert backed by
the Vault `ClusterIssuer`. `observable.linkFrom` is null, so keep this to the observed behavior.

## Tradeoffs (ACME vs cert-manager / `--acme` vs `--k8s`)
Both are additive demo layers over the same Vault CA; pick by *who consumes the cert*. Grounded in the
capability notes:

| | `--acme` (Caddy / ACME) | `--k8s` (cert-manager) |
|---|---|---|
| **Renewal driver** | the client (Caddy) speaks ACME to Vault and self-renews | cert-manager controller reconciles the `Certificate` |
| **Issuer path** | Vault's built-in ACME directory on `pki-int`, role `acme-demo` | `ClusterIssuer vault-pki-issuer` → Vault `pki-int` |
| **What gets a cert** | the Caddy pod `hal-caddy-acme` | nginx web pod `hal-web-pki` via Certificate `hal-web-pki-cert` |
| **TTL / cadence** | 5m, auto-renew at ~1/3 life (watch it live) | cert-manager-managed leaf cert rotation |
| **Demo URL** | `https://acme.localhost:8090` | `https://pki.localhost:8089` |
| **Best for** | "Let's-Encrypt-style" self-service renewal for any ACME client | issuing/rotating TLS for Kubernetes workloads |
| **Prereqs** | shared KinD cluster | `kind` + `kubectl` + `helm` on PATH |

For "I just want certs that renew themselves," `--acme` is the clearest live demo. For "I need TLS for my
pods," `--k8s` (cert-manager) is the idiomatic path. Both keep the private key in Vault and chain back to
the same Intermediate CA.

## Under the hood
Explain the mechanism grounded in the corpus, broken into key components, attaching the single most
relevant source link inline to each one (a specific doc section, tutorial step, API endpoint, or video
timestamp):
- **Root + Intermediate CA hierarchy** — `pki-root` signs `pki-int`; leaf certs chain to the intermediate
  so the root can stay offline-ish. ([source])
- **Issuing role (`pki-int/issue/hal-role`)** — allowed domains, `allow_subdomains`, `max_ttl 24h`,
  RSA 2048; private key generated in Vault. ([source])
- **Built-in ACME (`pki-int/config/acme`)** — Vault's ACME directory + role `acme-demo` driving Caddy's
  self-renewal. ([source])
- **cert-manager Vault issuer** — `ClusterIssuer vault-pki-issuer` → Vault `pki-int`, issuing the
  `Certificate hal-web-pki-cert`. ([source])

Each `[source]` is the closest-matching corpus entry. If none matches a component, explain it plainly and
omit the link rather than inventing one.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design, validated-pattern,
video), each linking to a real corpus entry. This is the broad recap; the inline citations above are the
targeted, per-component links. Prefer one strong card per type.
