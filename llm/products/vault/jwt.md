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

When you run `hal vault jwt --enable`, HAL wires Vault's JWT auth method to a local GitLab instance and creates bound-claims roles for CI pipeline authentication.

### What gets configured

- JWT auth mount bound to the local GitLab JWKS endpoint
- Roles with `bound_claims` that enforce protected tag constraints and project-level guards
- This is the **CI/pipeline** auth path — for human SSO use `hal vault oidc --enable`

### Inspect the JWT config

```shell
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='root'

# Confirm the JWT auth method is mounted and points to the local GitLab issuer
vault read auth/jwt/config

# List and inspect roles
vault list auth/jwt/role
vault read auth/jwt/role/<role-name>
```

### Test a token login (simulate CI)

```shell
# Obtain a GitLab CI_JOB_JWT token and attempt login
vault write auth/jwt/login \
  role=<role-name> \
  jwt=<CI_JOB_JWT>
```

### Why pipeline auth fails — bound claims

If login is rejected, the JWT claims must match the role's `bound_claims`. Common guards in this lab:
- `ref_protected: true` — pipeline must run on a protected branch or tag
- `project_path` — must match the exact GitLab project path

Use `vault read auth/jwt/role/<role-name>` to see the exact claim constraints.