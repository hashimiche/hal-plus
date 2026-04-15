<!-- hal-plus-spec
{
  "id": "vault_jwt",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "jwt",
  "title": "Vault JWT Auth Flow",
  "summary": "Enable the GitLab-backed JWT auth lab, verify bound claims, and troubleshoot CI token login behavior.",
  "priority": 97,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault jwt",
    "component": "vault_jwt",
    "verifyComponent": "vault_jwt",
    "planIntent": "enable vault jwt auth"
  },
  "match": {
    "any": [
      "hal vault jwt",
      "vault jwt",
      "jwt auth",
      "gitlab vault auth",
      "pipeline auth",
      "bound claims",
      "cicd role",
      "protected tags"
    ],
    "all": []
  },
  "helpCommand": ["vault", "jwt"],
  "statusCommands": [
    "hal vault status",
    "hal vault jwt",
    "hal status"
  ],
  "preflightChecks": [
    {
      "title": "Confirm base Vault is healthy",
      "why": "JWT auth bootstrap assumes Vault is already running before GitLab and the auth mount are configured.",
      "commands": [
        "hal vault status"
      ]
    }
  ],
  "actionCommands": [
    "hal vault jwt --enable",
    "hal vault jwt --force"
  ],
  "verifyCommands": [
    "hal vault jwt",
    "vault read auth/jwt/config",
    "vault read auth/jwt/role/cicd-role",
    "vault list auth/jwt/role"
  ],
  "resources": [
    {
      "title": "Vault JWT Auth Method",
      "href": "https://developer.hashicorp.com/vault/docs/auth/jwt",
      "kind": "official",
      "description": "JWT and OIDC auth method reference, including role and claim configuration."
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
      "title": "GitLab",
      "href": "http://gitlab.localhost:8080"
    }
  ],
  "focusBullets": [
    "The lab configures auth/jwt/ with role cicd-role and policy cicd-read.",
    "The default issuer is GitLab at http://gitlab.localhost:8080.",
    "Bound claims are project_path=root/secret-zero and ref=v* using glob matching.",
    "This is a CI-oriented machine auth flow, not a human browser SSO flow."
  ],
  "notes": [
    "If the user asks about browser login, route to the OIDC flow instead of JWT.",
    "Be explicit that the default role is tag-focused, so protected tag behavior matters in the demo.",
    "Use hal vault jwt --enable as the primary recommendation, then cite the JWT auth docs when role details are needed."
  ],
  "samplePrompts": [
    "How do I enable JWT auth in the Vault lab?",
    "Why is my GitLab JWT token failing bound claims?",
    "What does the cicd-role allow by default?"
  ]
}
-->

# Vault JWT in HAL

Use this pack for GitLab-backed JWT auth, CI token login, and bound-claims troubleshooting.

## Operator Rules

- Prefer `hal vault jwt --enable` for initial setup.
- Mention the protected tag guardrail when users ask why pipeline auth fails.
- Keep the answer HAL-first, then use the JWT auth docs for claim-level explanation.
- If the user needs human SSO, route to `hal vault oidc --enable` instead.