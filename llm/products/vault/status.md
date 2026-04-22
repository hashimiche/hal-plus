<!-- hal-plus-spec
{
  "id": "vault_status",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "status",
  "title": "Check Vault Status",
  "summary": "Check Vault runtime health and active integrations before enabling or troubleshooting scenario labs.",
  "priority": 80,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault status",
    "component": "vault",
    "verifyComponent": "vault"
  },
  "match": {
    "any": [
      "hal vault status",
      "vault status",
      "is vault up",
      "is vault running",
      "vault health"
    ],
    "all": []
  },
  "helpCommand": ["vault", "status"],
  "statusCommands": [
    "hal status",
    "hal vault status"
  ],
  "actionCommands": [
    "hal vault status"
  ],
  "verifyCommands": [
    "hal vault status",
    "curl -s http://vault.localhost:8200/v1/sys/health"
  ],
  "resources": [
    {
      "title": "Vault Docs",
      "href": "https://developer.hashicorp.com/vault",
      "kind": "official",
      "description": "Vault reference docs."
    }
  ],
  "uiLinks": [
    {
      "title": "Vault UI",
      "href": "http://vault.localhost:8200"
    }
  ],
  "focusBullets": [
    "Run hal vault status before enabling JWT, OIDC, K8s, LDAP, or database scenarios.",
    "If Vault is down, restore base deploy first before scenario-level troubleshooting."
  ],
  "notes": [
    "Status output includes ecosystem container hints for Keycloak, GitLab, LDAP, database backends, and KinD.",
    "If status shows crash logs with license clues, route to Enterprise license checks and redeploy guidance."
  ],
  "samplePrompts": [
    "Is Vault healthy in my lab?",
    "How do I quickly verify Vault before enabling k8s auth?"
  ]
}
-->

# Vault Status in HAL

Use this pack for readiness checks and health triage before scenario operations.

## Operator Rules

- Prefer `hal vault status` first.
- If down, route to `hal vault create`.
- If partial scenario drift appears, route to the specific scenario force-reset flow instead of generic destroy/redeploy.
