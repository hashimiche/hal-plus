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
      "title": "Vault Docs",
      "href": "https://developer.hashicorp.com/vault",
      "kind": "official",
      "description": "Official Vault documentation."
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

# Vault K8s in HAL

Use this pack for Vault Kubernetes auth, KinD, Vault Secrets Operator, and CSI versus native-sync questions.

## Operator Rules

- Prefer `hal vault k8s --enable` as the shortest HAL-first answer.
- If the user asks for CSI, call out that the lab requires Enterprise for that path.
- Verification should include both Vault-side auth checks and cluster-side pod or VSO checks.
- The main operator-facing endpoint for the demo app is `http://web.localhost:8088`.