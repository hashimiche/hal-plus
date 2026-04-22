<!-- hal-plus-spec
{
  "id": "vault_deploy",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "deploy",
  "title": "Deploy Vault CE or Enterprise",
  "summary": "Deploy local Vault in dev mode, enforce Enterprise licensing when requested, and wire observability artifacts when available.",
  "priority": 95,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault create",
    "component": "vault",
    "verifyComponent": "vault",
    "planIntent": "create vault"
  },
  "match": {
    "any": [
      "hal vault create",
      "create vault",
      "deploy vault",
      "start vault",
      "vault ce",
      "vault enterprise",
      "vault license",
      "vault obs"
    ],
    "all": []
  },
  "helpCommand": ["vault", "create"],
  "statusCommands": [
    "hal status",
    "hal vault status"
  ],
  "preflightChecks": [
    {
      "title": "Choose edition explicitly",
      "why": "Enterprise-only feature requests should not accidentally run on CE.",
      "commands": [
        "hal vault create --edition ce",
        "hal vault create --edition ent"
      ]
    },
    {
      "title": "Set Enterprise license when required",
      "why": "Vault Enterprise deploy enforces VAULT_LICENSE before startup.",
      "commands": [
        "export VAULT_LICENSE='your_license_string'"
      ]
    }
  ],
  "actionCommands": [
    "hal vault create",
    "hal vault create --edition ent",
    "hal obs create",
    "hal vault obs create"
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
      "description": "Official product docs."
    },
    {
      "title": "Vault Enterprise Solution Design Guide",
      "href": "https://developer.hashicorp.com/validated-designs/vault-solution-design-guides-vault-enterprise",
      "kind": "guide",
      "description": "Enterprise deployment and operations guidance."
    }
  ],
  "uiLinks": [
    {
      "title": "Vault UI",
      "href": "http://vault.localhost:8200"
    }
  ],
  "focusBullets": [
    "Default create flow is dev mode with root token root.",
    "Enterprise create flow blocks until VAULT_LICENSE is set.",
    "For monitoring, run hal obs create first then hal vault obs create."
  ],
  "notes": [
    "If the user requests Sentinel (RGP/EGP), CSI mode, or other Enterprise-only workflows, recommend --edition ent explicitly.",
    "Vault observability artifacts are managed explicitly with hal vault obs create/update/delete/status.",
    "If obs is not running, direct the user to hal obs create first."
  ],
  "samplePrompts": [
    "Deploy Vault Enterprise locally",
    "Why is Vault deploy failing with license errors?",
    "How do I wire Vault metrics after deploying observability?"
  ]
}
-->

# Vault Deploy in HAL

Use this pack for bring-up, re-bring-up, or edition-selection questions for Vault.

## Operator Rules

- Always call out that HAL creates Vault in dev mode and root token is `root`.
- For Enterprise asks, require `--edition ent` and `VAULT_LICENSE` explicitly.
- For observability, prefer explicit lifecycle commands: `hal obs create`, then `hal vault obs create`.
- Verify with `hal vault status` before moving into scenario skills.
