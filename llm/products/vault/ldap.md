<!-- hal-plus-spec
{
  "id": "vault_ldap",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "ldap",
  "title": "Vault LDAP Auth And Secrets Flow",
  "summary": "Enable the OpenLDAP plus phpLDAPadmin lab, configure LDAP auth, and explore dynamic, static, and library-style LDAP secrets.",
  "priority": 96,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault ldap",
    "component": "vault_ldap",
    "verifyComponent": "vault_ldap",
    "planIntent": "enable vault ldap"
  },
  "match": {
    "any": [
      "hal vault ldap",
      "vault ldap",
      "ldap auth",
      "openldap",
      "phpldapadmin",
      "ldap secrets engine",
      "dynamic ldap credentials",
      "static ldap role"
    ],
    "all": []
  },
  "helpCommand": ["vault", "ldap"],
  "statusCommands": [
    "hal vault status",
    "hal vault ldap",
    "hal status"
  ],
  "preflightChecks": [
    {
      "title": "Confirm base Vault is healthy",
      "why": "LDAP auth and secrets configuration assumes the main Vault lab is already running.",
      "commands": [
        "hal vault status"
      ]
    }
  ],
  "actionCommands": [
    "hal vault ldap enable",
    "hal vault ldap update"
  ],
  "verifyCommands": [
    "hal vault ldap",
    "vault read auth/ldap/config",
    "vault read ldap/config",
    "vault read ldap/role/dynamic-reader",
    "vault read ldap/static-role/static-app",
    "vault read ldap/library/dev-pool"
  ],
  "resources": [
    {
      "title": "Vault LDAP Auth Method",
      "href": "https://developer.hashicorp.com/vault/docs/auth/ldap",
      "kind": "official",
      "description": "LDAP auth method configuration for directory-backed human login."
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
      "title": "phpLDAPadmin",
      "href": "https://phpldapadmin.localhost:8082"
    }
  ],
  "focusBullets": [
    "The lab configures both auth/ldap/ and the ldap/ secrets engine path.",
    "The secrets examples include dynamic-reader, static-app, and dev-pool library checkout.",
    "OpenLDAP and phpLDAPadmin are part of the workflow, not just Vault-side auth wiring.",
    "The lab includes root credential rotation for the LDAP secrets engine bind account."
  ],
  "notes": [
    "If teardown is blocked, prefer hal vault ldap update so lease cleanup runs before container removal.",
    "When the user asks only about human login, keep the answer anchored on auth/ldap and do not overexplain the secrets engine path unless relevant.",
    "Use phpLDAPadmin as the UI reference point when the user wants to inspect seeded users or groups."
  ],
  "samplePrompts": [
    "How do I enable LDAP auth in the Vault lab?",
    "What does the LDAP secrets engine demo create?",
    "How do I test dynamic versus static LDAP credentials?"
  ]
}
-->

When you run `hal vault ldap enable`, HAL brings up an OpenLDAP container and phpLDAPadmin, then configures both the LDAP auth method and the LDAP secrets engine in Vault.

### What gets created

| Component | Value |
|---|---|
| Auth mount | `auth/ldap/` |
| Secrets mount | `ldap/` |
| Policies | `ldap-admin`, `ldap-reader` |
| Dynamic role | `ldap/role/dynamic-reader` |
| Static role | `ldap/static-role/static-app` |
| Library | `ldap/library/dev-pool` |
| Directory UI | `https://phpldapadmin.localhost:8082` |

### Inspect auth and secrets config

```shell
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='root'

# Auth method configuration (LDAP server URL, bind DN, user search)
vault read auth/ldap/config

# Group-to-policy mappings
vault read auth/ldap/groups/admin
vault read auth/ldap/groups/reader

# LDAP secrets engine config (service account manager)
vault read ldap/config
vault read ldap/role/dynamic-reader
vault read ldap/static-role/static-app
vault read ldap/library/dev-pool
```

### Test login and credential generation

```shell
# Login as a seeded LDAP user
vault login -method=ldap username=bob password=password

# Generate a short-lived dynamic LDAP user
vault read ldap/creds/dynamic-reader

# Read a rotated static service account password
vault read ldap/static-cred/static-app

# Check out a credential from the dev-pool library
vault write -f ldap/library/dev-pool/check-out
```

The root bind account password is rotated by Vault once the LDAP secrets engine is configured — it will no longer be the original static value.