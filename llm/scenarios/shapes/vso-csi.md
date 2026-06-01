<!-- hal-plus-scenario
{
  "id": "vso-csi",
  "title": "Vault secrets on Kubernetes (VSO native vs CSI)",
  "priority": 88,
  "intent": {
    "any": [
      "vault secrets operator",
      "vso",
      "vault secrets into kubernetes",
      "vault secret into kubernetes",
      "secrets into my kubernetes pods",
      "vault secrets in k8s",
      "sync a vault secret into kubernetes",
      "sync vault secret to kubernetes",
      "native vs csi",
      "vso native vs csi",
      "difference between k8s secrets and csi",
      "difference with csi",
      "mount a vault secret as a file",
      "mount secret as a volume",
      "inject a vault secret as an env var",
      "security team doesn't like k8s secrets",
      "kubernetes secrets aren't encrypted",
      "k8s secrets are not encrypted",
      "keep secrets out of etcd",
      "secrets out of etcd",
      "encrypt secrets at rest in kubernetes",
      "set up vso",
      "vso on kind",
      "secure secrets in my kubernetes",
      "secure secrets in kubernetes",
      "secure secrets in my k8s",
      "secure secrets in k8s",
      "secure secret in my kubernetes",
      "secure secret in kubernetes",
      "secure kubernetes secrets",
      "secure k8s secrets",
      "secure my kubernetes secrets",
      "secure my k8s secrets",
      "secrets in my kubernetes pod",
      "secret in my kubernetes pod",
      "secrets in kubernetes pod",
      "secrets in my k8s pod",
      "protect secrets in kubernetes",
      "protect my kubernetes secrets",
      "manage secrets in kubernetes",
      "secrets management in kubernetes",
      "secrets management in k8s",
      "get secrets into a pod",
      "get a secret into a pod",
      "deliver secrets to a pod",
      "deliver a secret to my pod"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "vault_k8s_vso",
  "slots": [
    { "name": "overview",        "source": "model+corpus" },
    { "name": "provision",       "source": "graph.action(dependsOn-walk)" },
    { "name": "access",          "source": "mcp.statusTool(access.surfaces+credentials)" },
    { "name": "trigger",         "source": "graph.manualTrigger" },
    { "name": "observe",         "source": "mcp.statusTool(observable.linkFrom)" },
    { "name": "tradeoffs",       "source": "graph.notes+corpus", "compare": ["native", "csi"] },
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

# Scenario shape: Vault secrets on Kubernetes (VSO native vs CSI)

A **reconcile-and-deliver** exemplar: Vault is the source of truth and the Vault Secrets Operator (VSO)
delivers a secret into a Kubernetes workload — either by syncing it to a **native Kubernetes Secret**
(consumed as an env var) or by **CSI** projection (mounted as a file). The same 7 base slots apply, plus
a dedicated **tradeoffs** slot because the most common real question here is comparative ("native vs CSI",
"my security team doesn't like K8s Secrets"). "Trigger" is updating the secret in Vault and watching the
app pick it up (native mode); "Observe" is the new value being served with no downtime.

Keep prose grounded: commands come from the capability graph (`{{primary.dependsOn}}` → `{{primary.action}}`),
the live-update step comes from `{{primary.manualTrigger}}`, and the native/CSI mechanics, the Enterprise
gate, and the security framing come from the capability notes and corpus — never invented. Two grounding
rules are mandatory on this route:
1. **CSI requires Vault Enterprise.** On Vault Community Edition, `--csi` silently downgrades to native
   sync. Never present CSI as available on CE.
2. **State the K8s-Secret security point precisely.** A native Kubernetes Secret is base64 in etcd and is
   only encrypted at rest if the cluster has etcd encryption-at-rest configured; CSI's advantage is that
   it keeps the secret *out of etcd* (no Secret object), not that it is "more encrypted." Do not claim K8s
   Secrets are plaintext-insecure, and do not claim they are fully encrypted by default.

## Overview
Name the capability (`{{primary.label}}`) and the idea in a sentence or two: Vault holds the secret, VSO
reconciles it into the cluster, and the workload consumes it without ever calling Vault. Mention up front
that there are two delivery modes (native sync vs CSI). Pull conceptual framing from the corpus when
available; otherwise summarize from `{{primary.provides}}`.

## Provision
List the commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`:

```bash
hal vault create                  # brings up Vault (capability: vault)
hal vault k8s enable              # KinD + VSO (Helm) + Vault auth + demo app — NATIVE sync (capability: vault_k8s_vso)
# or, on Vault Enterprise only:
hal vault k8s enable --csi        # same flow, but secret delivered via the CSI driver (Enterprise-gated)
```

Note the prerequisites (`kind`, `kubectl`, `helm` on PATH) and that `--csi` downgrades to native on a
non-Enterprise Vault.

## Access
Surface where the demo lives: `http://web.localhost:8088` (service `hal-web-proxy` in namespace `app1`,
fronting Deployment `hal-web-backend`); VSO runs in namespace `vso`. The status tool
`get_k8s_integration_status` returns text status (KinD / VSO / Vault auth / demo-mode), not a structured
payload, so describe these known facts rather than a dotted path. Do not fabricate field paths.

## Trigger
State the live-update action from `{{primary.manualTrigger}}` (native mode): update the source secret in
Vault and watch the app pick it up.

```bash
vault kv put kv-k8s/app1 <key>=<new-value>
# then refresh http://web.localhost:8088
```

Call out that this auto-reload behavior is **native-only** — in CSI mode the file is reprojected but there
is no `rolloutRestartTargets` rollout.

## Observe
Describe the proof from `{{primary.observable.what}}`: the app serves a value that came from Vault via VSO
(the app never called Vault). In native mode, the change in Vault triggers a rolling restart of
`hal-web-backend` within `refreshAfter` (15s); because `hal-web-proxy` fronts the backend
(`replicas: 2`, `maxUnavailable: 0`, `maxSurge: 1`) the reload is zero-downtime and invisible — the user
just refreshes and sees the new value. `observable.linkFrom` is null, so keep this to the observed behavior.

## Tradeoffs (native vs CSI)
Answer the comparative question directly, grounded in the capability notes. Present both options with
honest pros and cons:

| | Native (Kubernetes Secret) | CSI (`--csi`, Enterprise only) |
|---|---|---|
| **Where the secret lives** | a real K8s `Secret` (`hal-web-secret`) in **etcd**, base64; encrypted at rest only if etcd encryption-at-rest is configured | projected into the pod's **tmpfs/volume** as a file; **no Secret object in etcd** |
| **Visibility** | `kubectl get secret`, namespace RBAC | not a Secret object; mounted file only |
| **Consumption** | env var (or volume) | mounted file |
| **Live update** | ✅ `refreshAfter` + `rolloutRestartTargets` auto-rolls the pod (proxy hides it) | ❌ no auto-rollout; app must re-read/watch the file |
| **License** | Vault CE / Community is fine | **Vault Enterprise required** (CE downgrades to native) |
| **Best for** | simplicity, env-var apps, transparent reload | security teams who require secrets to stay out of etcd |

For the "my security team doesn't like K8s Secrets / they're not encrypted" question: acknowledge the real
concern (native Secrets sit in etcd base64, encrypted only with encryption-at-rest), then give both
mitigations honestly — **CSI** keeps the secret out of etcd entirely *if they have Vault Enterprise*;
otherwise on CE the mitigation is **etcd encryption-at-rest + tight RBAC** while keeping native sync.

## Under the hood
Explain the mechanism grounded in the corpus, broken into key components, attaching the single most
relevant source link inline to each one (a specific doc section, tutorial step, API endpoint, or video
timestamp):
- **Vault Secrets Operator reconcile loop** — VSO watches `VaultStaticSecret`/`VaultAuth` CRDs and
  reconciles the Vault value into the cluster. ([source])
- **Native sync (`VaultStaticSecret` → `Secret`)** — `refreshAfter` polling, `destination` Secret, and
  `rolloutRestartTargets` for auto-rollout. ([source])
- **CSI projection (`csi.vso.hashicorp.com`)** — secret mounted as a file with no persistent Secret
  object; Enterprise-gated. ([source])
- **Vault auth on Kubernetes** — `kubernetes/` (or `jwt-k8s/` OIDC) auth backing the `VaultAuth` CRD. ([source])

Each `[source]` is the closest-matching corpus entry. If none matches a component, explain it plainly and
omit the link rather than inventing one.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design, validated-pattern,
video), each linking to a real corpus entry. This is the broad recap; the inline citations above are the
targeted, per-component links. Prefer one strong card per type.
