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
    "hal vault ldap --enable",
    "hal vault ldap --force"
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
    "If teardown is blocked, prefer hal vault ldap --force so lease cleanup runs before container removal.",
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

# Vault LDAP in HAL

Use this pack for LDAP-backed human login and the LDAP secrets engine demo.

## Operator Rules

- Prefer `hal vault ldap --enable` for setup and `hal vault ldap --force` for repair or reset.
- Be explicit about whether the user means LDAP auth, LDAP secrets, or both.
- Reference phpLDAPadmin when directory inspection is part of the workflow.
- Keep the answer HAL-first and only drop to `vault read` or `vault login -method=ldap` for verification and day-2 checks.