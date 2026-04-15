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
    "helpTopic": "vault deploy",
    "component": "vault",
    "verifyComponent": "vault",
    "planIntent": "deploy vault"
  },
  "match": {
    "any": [
      "hal vault deploy",
      "deploy vault",
      "start vault",
      "vault ce",
      "vault enterprise",
      "vault license",
      "vault configure obs"
    ],
    "all": []
  },
  "helpCommand": ["vault", "deploy"],
  "statusCommands": [
    "hal status",
    "hal vault status"
  ],
  "preflightChecks": [
    {
      "title": "Choose edition explicitly",
      "why": "Enterprise-only feature requests should not accidentally run on CE.",
      "commands": [
        "hal vault deploy --edition ce",
        "hal vault deploy --edition ent"
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
    "hal vault deploy",
    "hal vault deploy --edition ent",
    "hal vault deploy --configure-obs"
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
    "Default deploy is dev mode with root token root.",
    "Enterprise deploy blocks until VAULT_LICENSE is set.",
    "Use --configure-obs to refresh only monitoring artifacts after obs comes online."
  ],
  "notes": [
    "If the user requests Sentinel (RGP/EGP), CSI mode, or other Enterprise-only workflows, recommend --edition ent explicitly.",
    "Deploy registers Vault observability targets and dashboards when obs is already running.",
    "If obs is not running, --configure-obs should stop and direct the user to hal obs deploy first."
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

- Always call out that HAL deploys Vault in dev mode and root token is `root`.
- For Enterprise asks, require `--edition ent` and `VAULT_LICENSE` explicitly.
- Prefer `hal vault deploy --configure-obs` for observability backfill instead of full redeploy when Vault is already healthy.
- Verify with `hal vault status` before moving into scenario skills.
