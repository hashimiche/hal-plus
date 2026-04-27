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
      "browser login",
      " oidc ",
      "oidc lab",
      "oidc method",
      "enable oidc"
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
    "hal vault oidc enable",
    "hal vault oidc update"
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

When you run `hal vault oidc enable`, HAL brings up a Keycloak container and wires Vault's OIDC auth method to use it for human browser-based login.

### What gets created

| Component | Value |
|---|---|
| Auth mount | `auth/oidc/` |
| KV mount | `kv-oidc/` |
| Policies | `admin`, `user-ro` |
| Demo users | `alice`, `bob` |
| Keycloak realm | `hal` |
| Discovery URL | `http://keycloak.localhost:8081/realms/hal` |
| OIDC client | `vault` |
| External groups | `admin`, `user-ro` (Keycloak groups → Vault identity groups) |

### Inspect the OIDC config

```shell
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='root'

# Confirm the OIDC auth method is mounted and points to Keycloak
vault read auth/oidc/config

# Inspect the default role (allowed_redirect_uris, groups_claim, token_policies)
vault read auth/oidc/role/default

# Check that external groups are mapped
vault list identity/group
```

### Test browser login

```shell
# Opens a browser window — Vault will redirect to Keycloak
vault login -method=oidc
# Login as alice or bob; Vault issues a token scoped to the matching policy
```

### Troubleshoot callback errors

The allowed callback URL must be `http://localhost:8250/oidc/callback`. If it doesn't match the Keycloak client config, login fails with a redirect_uri mismatch error. Check the Keycloak `hal` realm → Clients → `vault` → Valid redirect URIs.