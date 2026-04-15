<!-- hal-plus-spec
{
  "id": "vault_oidc",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "oidc",
  "title": "Vault OIDC And Keycloak Flow",
  "summary": "Enable the Keycloak-backed OIDC lab for human login, group-to-policy mapping, and browser callback troubleshooting.",
  "priority": 96,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault oidc",
    "component": "vault_oidc",
    "verifyComponent": "vault_oidc",
    "planIntent": "enable vault oidc"
  },
  "match": {
    "any": [
      "hal vault oidc",
      "vault oidc",
      "oidc auth",
      "keycloak",
      "vault sso",
      "human sso",
      "oidc callback",
      "browser login"
    ],
    "all": []
  },
  "helpCommand": ["vault", "oidc"],
  "statusCommands": [
    "hal vault status",
    "hal vault oidc",
    "hal status"
  ],
  "preflightChecks": [
    {
      "title": "Confirm base Vault is healthy",
      "why": "OIDC wiring assumes the main Vault instance is already available before Keycloak-backed auth is configured.",
      "commands": [
        "hal vault status"
      ]
    }
  ],
  "actionCommands": [
    "hal vault oidc --enable",
    "hal vault oidc --force"
  ],
  "verifyCommands": [
    "hal vault oidc",
    "vault read auth/oidc/config",
    "vault read auth/oidc/role/default"
  ],
  "resources": [
    {
      "title": "Vault JWT And OIDC Auth Method",
      "href": "https://developer.hashicorp.com/vault/docs/auth/jwt",
      "kind": "official",
      "description": "Reference docs for OIDC auth roles, callbacks, and provider-backed login."
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
      "title": "Keycloak",
      "href": "http://keycloak.localhost:8081"
    }
  ],
  "focusBullets": [
    "The lab configures auth/oidc/ against Keycloak realm hal.",
    "Keycloak groups admin and user-ro are mapped to Vault external identity groups and policies.",
    "This is the human SSO path for the local lab, distinct from JWT pipeline auth.",
    "The default callback workflow uses the local browser-based vault login experience."
  ],
  "notes": [
    "If the user asks about pipeline tokens or GitLab CI, route to JWT instead of OIDC.",
    "When callback or redirect issues appear, keep the diagnosis anchored on auth/oidc/config and the allowed callback URL.",
    "Use hal vault oidc --enable as the primary recommendation, then cite the OIDC auth docs for deeper role or claim configuration."
  ],
  "samplePrompts": [
    "How do I enable OIDC login for Vault in HAL?",
    "How is Keycloak wired to Vault policies?",
    "Why is my Vault browser login redirect failing?"
  ]
}
-->

# Vault OIDC in HAL

Use this pack for Keycloak-backed human login, browser redirects, and OIDC group-mapping questions.

## Operator Rules

- Prefer `hal vault oidc --enable` as the setup command.
- Explain that this is the human SSO path and that JWT is the CI path.
- Keep troubleshooting focused on the Keycloak realm, callback URL, and role config instead of generic auth narration.
- Mention the Keycloak UI when users want to inspect groups or realm objects directly.