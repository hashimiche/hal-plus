<!-- hal-plus-spec
{
  "id": "vault_k8s",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "k8s",
  "title": "Vault Kubernetes Auth And VSO Flow",
  "summary": "Enable the KinD plus Vault Secrets Operator lab, validate the kubernetes auth method, and choose native sync versus CSI mode.",
  "priority": 98,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault k8s",
    "component": "vault_k8s",
    "verifyComponent": "vault_k8s",
    "planIntent": "enable vault kubernetes auth"
  },
  "match": {
    "any": [
      "hal vault k8s",
      "vault k8s",
      "k8s auth engine",
      "kubernetes auth engine",
      "kubernetes auth method",
      "enable kubernetes",
      "kubernetes auth",
      "vault secrets operator",
      "vso",
      "kind",
      "csi",
      "pod identity"
    ],
    "all": []
  },
  "helpCommand": ["vault", "k8s"],
  "statusCommands": [
    "hal vault status",
    "hal vault k8s",
    "hal status"
  ],
  "preflightChecks": [
    {
      "title": "Confirm base Vault is healthy",
      "why": "The KinD and VSO lab assumes Vault is already reachable before auth wiring starts.",
      "commands": [
        "hal vault status"
      ]
    }
  ],
  "actionCommands": [
    "hal vault k8s --enable",
    "hal vault k8s --enable --csi",
    "hal vault k8s --force"
  ],
  "verifyCommands": [
    "hal vault k8s",
    "vault read auth/kubernetes/config",
    "vault read auth/kubernetes/role/app1-role",
    "kubectl get pods -n vso",
    "kubectl get pods -n app1"
  ],
  "resources": [
    {
      "title": "Vault Kubernetes Auth Method",
      "href": "https://developer.hashicorp.com/vault/docs/auth/kubernetes",
      "kind": "official",
      "description": "Configure the Kubernetes auth method and service account token validation."
    },
    {
      "title": "Vault K8s Auth — Configuring Kubernetes",
      "href": "https://developer.hashicorp.com/vault/docs/auth/kubernetes#configuring-kubernetes",
      "kind": "official",
      "description": "Step-by-step guide to configure the Kubernetes auth method backend."
    },
    {
      "title": "Vault K8s Auth — Reviewer JWT",
      "href": "https://developer.hashicorp.com/vault/docs/auth/kubernetes#use-the-vault-client-s-jwt-as-the-reviewer-jwt",
      "kind": "official",
      "description": "Using the Vault client JWT as the reviewer JWT — critical for ambient credential environments."
    },
    {
      "title": "Vault K8s Auth — Kubernetes Auth Method Overview",
      "href": "https://developer.hashicorp.com/vault/docs/auth/kubernetes#kubernetes-auth-method",
      "kind": "official",
      "description": "Overview of how the Kubernetes auth method works with service account tokens."
    }
  ],
  "uiLinks": [
    {
      "title": "Vault UI",
      "href": "http://vault.localhost:8200"
    },
    {
      "title": "K8s Demo App",
      "href": "http://web.localhost:8088"
    }
  ],
  "focusBullets": [
    "Default mode is native sync with VaultStaticSecret and automated rollout refresh.",
    "CSI mode is requested with --csi and is Enterprise-only in this lab.",
    "The main Vault role is auth/kubernetes/role/app1-role and the demo secret lives under kv-k8s/app1.",
    "The lab exposes a local web endpoint rather than requiring port-forward steps."
  ],
  "notes": [
    "If CSI is requested on OSS Vault, explain the automatic downgrade to native mode instead of pretending CSI succeeded.",
    "Use hal vault k8s --enable as the HAL-first answer for kubernetes auth setup questions.",
    "When the user asks how to configure the auth engine, pair the HAL command with the direct Kubernetes auth docs link."
  ],
  "samplePrompts": [
    "I want to configure the k8s auth engine",
    "How do I enable Vault Secrets Operator in HAL?",
    "What is the CSI path for the Vault k8s lab?"
  ]
}
-->

When you run `hal vault k8s --enable`, HAL wires a full KinD cluster to the local Vault instance and deploys Vault Secrets Operator via Helm.

### What gets created

| Component | Value |
|---|---|
| Auth mount | `auth/kubernetes/` |
| Vault role | `app1-role` (bound to service account `app1-sa`) |
| Policy | `app1-read` |
| KV mount | `kv-k8s/` |
| Demo app endpoint | `http://web.localhost:8088` |

### Inspect the auth config

```shell
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='root'

# Confirm the kubernetes auth method is mounted and configured
vault read auth/kubernetes/config

# Inspect the role that maps app1-sa to the app1-read policy
vault read auth/kubernetes/role/app1-role

# Read the demo secret that VSO syncs into the cluster
vault kv get kv-k8s/app1
```

### Cluster-side verification

```shell
# VSO and app1 namespaces must both be Running
kubectl get pods -n vso
kubectl get pods -n app1
helm list -n vso

# Native mode: check the VaultStaticSecret resource
kubectl get vaultstaticsecret vso-mysecret -n app1

# CSI mode (Enterprise only): check the CSI secret
kubectl get csisecrets hal-csi-secrets -n app1
```

### Tune the role after deploy (optional)

```shell
# Extend TTL or add a second namespace binding
vault write auth/kubernetes/role/app1-role \
  bound_service_account_names=app1-sa \
  bound_service_account_namespaces=app1 \
  policies=app1-read \
  ttl=24h
```

CSI mode requires Vault Enterprise — HAL automatically falls back to native sync on OSS Vault.