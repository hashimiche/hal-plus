<!-- hal-plus-spec
{
  "id": "vault_database",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "database",
  "title": "Vault Database Secrets Flow",
  "summary": "Enable the database secrets engine lab, generate dynamic credentials, and validate role and root rotation behavior.",
  "priority": 97,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault database",
    "component": "vault_database",
    "verifyComponent": "vault_database",
    "planIntent": "enable vault database secrets"
  },
  "match": {
    "any": [
      "hal vault database",
      "vault database",
      "database secret engine",
      "database secrets engine",
      "database secrets",
      "database engine",
      "db engine",
      "db secrets",
      "db credentials",
      "dynamic db credentials",
      "rotate root",
      "jit credentials"
    ],
    "all": []
  },
  "helpCommand": ["vault", "database"],
  "statusCommands": [
    "hal vault status",
    "hal vault database",
    "hal status"
  ],
  "preflightChecks": [
    {
      "title": "Confirm base Vault is healthy",
      "why": "The database secrets engine lab assumes Vault is already running before the database connection is configured.",
      "commands": [
        "hal vault status"
      ]
    }
  ],
  "actionCommands": [
    "hal vault database --enable",
    "hal vault database --enable --backend mariadb",
    "hal vault database --force"
  ],
  "verifyCommands": [
    "hal vault database",
    "vault read database/config/hal-vault-mariadb",
    "vault read database/roles/dba-role",
    "vault read database/creds/dba-role"
  ],
  "resources": [
    {
      "title": "Vault Database Secrets Engine",
      "href": "https://developer.hashicorp.com/vault/docs/secrets/databases",
      "kind": "official",
      "description": "Reference docs for the database secrets engine and role configuration."
    },
    {
      "title": "Vault Database Secrets Tutorial",
      "href": "https://developer.hashicorp.com/vault/tutorials/db-credentials/database-secrets?variants=vault-deploy%3Aselfhosted#configure-the-database-secrets-engine",
      "kind": "official",
      "description": "Direct tutorial section for configuring the database secrets engine."
    }
  ],
  "uiLinks": [
    {
      "title": "Vault UI",
      "href": "http://vault.localhost:8200"
    }
  ],
  "focusBullets": [
    "Connection name is hal-vault-mariadb and the main dynamic role is dba-role.",
    "Vault rotates the initial vaultadmin database password so the root credential becomes Vault-owned.",
    "This lab demonstrates JIT-style dynamic credentials through the database secrets engine.",
    "The same dynamic credential pattern is useful context for Boundary integration stories."
  ],
  "notes": [
    "Use hal vault database -e --backend mariadb as the HAL-first answer for database secrets engine setup.",
    "When the user asks for configuration steps, pair the HAL command with the direct database tutorial section link.",
    "If the user wants SQL or TTL tuning, move to exact vault write commands against database/roles/dba-role."
  ],
  "samplePrompts": [
    "I want to try the database secret engine in Vault",
    "How do I configure the database secrets engine?",
    "How do I enable database JIT credentials in HAL?",
    "What role and connection names does the Vault database lab create?"
  ]
}
-->

# Vault Database in HAL

Use this pack for the database secrets engine, dynamic credentials, and root-rotation questions.

## Operator Rules

- Prefer `hal vault database -e --backend mariadb` as the shortest default setup command.
- Mention `dba-role` and `database/config/hal-vault-mariadb` when users ask for exact object names.
- If users ask for Postgres backend, state that it is planned but not implemented yet.
- Keep the answer HAL-first, then cite the direct database tutorial section for configuration detail.
- If the user asks about reusable JIT credentials for other products, mention the Boundary compatibility angle briefly.