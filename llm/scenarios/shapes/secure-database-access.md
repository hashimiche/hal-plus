<!-- hal-plus-scenario
{
  "id": "secure-database-access",
  "title": "Secure database access (Boundary + Vault)",
  "priority": 90,
  "intent": {
    "any": [
      "secure my db access",
      "secure my database access",
      "secure database access",
      "secure db access",
      "database access with boundary",
      "boundary database access",
      "access a database through boundary",
      "jit database credentials in boundary",
      "manage my jit database credentials in boundary",
      "vault to manage my jit database credentials",
      "broker vault credentials",
      "brokered credentials",
      "credential brokering",
      "passwordless database access",
      "passwordless db access",
      "secret zero",
      "zero trust model with a database",
      "zero trust database",
      "vault and boundary"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "boundary_mariadb",
  "slots": [
    { "name": "overview",        "source": "model+corpus" },
    { "name": "provision",       "source": "graph.action(dependsOn-walk)" },
    { "name": "access",          "source": "mcp.statusTool(access.surfaces+credentials)" },
    { "name": "trigger",         "source": "graph.manualTrigger" },
    { "name": "observe",         "source": "mcp.statusTool(observable.linkFrom)" },
    { "name": "under_the_hood",  "source": "corpus", "coverage": ["docs", "tutorial", "validated-design", "video"], "citePerComponent": true },
    { "name": "learn_more",      "source": "corpus.cards(group_by=source_type)" }
  ],
  "grounding": {
    "commandsFrom": ["graph", "mcp"],
    "linksFrom": ["mcp", "corpus"],
    "liveFactsFrom": ["mcp"],
    "prose": "model-owned (verbatim constraint loosened for this route)"
  }
}
-->

# Scenario shape: Secure database access (Boundary + Vault)

A **broker-and-inject** exemplar that combines two products: Vault's database secrets engine *mints*
short-lived credentials, and Boundary *brokers* them into an identity-based session to the database
target. The teaching takeaway is **no secret zero** — the user authenticates as themselves, never holds
a database password, and the injected credential is short-lived and auto-revoked. The same 7 slots
apply: "Trigger" is authenticating to Boundary and opening the session; "Observe" is the brokered
credential being injected without the user ever seeing it.

Keep prose grounded: commands come from the capability graph (walking `{{primary.dependsOn}}` then
`{{primary.action}}`), the session steps come from `{{primary.manualTrigger}}`, and the brokering /
lease behavior is described from the corpus and capability notes — never invented. This scenario is the
`--with-vault` path; do **not** describe the standalone static-credential path as if it used Vault.

## Overview
Name the capability (`{{primary.label}}`) and the security idea in a sentence or two: instead of sharing
a standing database password, Vault mints a fresh short-lived credential and Boundary injects it into an
identity-based session — the user connects without ever seeing the secret. Pull conceptual framing
("secret zero", "zero trust", "just-in-time access") from the corpus when available; otherwise summarize
from `{{primary.provides}}`.

## Provision
List the commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`:

```bash
hal vault create                              # brings up Vault (capability: vault)
hal vault database enable                     # MariaDB + Vault database/ secrets engine, role dba-role (capability: vault_database)
hal boundary create                           # brings up the Boundary controller (capability: boundary)
hal boundary mariadb enable --with-vault      # brokers Vault dynamic creds to the Boundary target (capability: boundary_mariadb)
```

Note the `--with-vault` flag: it attaches Boundary to the existing `hal-vault-mariadb` and links the
target to Vault dynamic credentials. Without it, the command would deploy a standalone MariaDB with a
static user and no Vault brokering.

## Access
Surface where access happens. When the status tool only returns text status (no structured payload, as
with `get_boundary_mariadb_status`), describe the known facts from the capability notes rather than a
dotted path — the Boundary controller at `http://boundary.localhost:9200`, Boundary auth method
`lab-auth` with login `dba-user`, and target `mariadb-secure-access` (scope: org `hal-academy` /
project `db-infrastructure`). Do not fabricate field paths the status tool does not return. The database
credential is intentionally **not** an access detail here — that's the whole point: Boundary brokers it.

## Trigger
State the actions that open a brokered session, taken from `{{primary.manualTrigger}}`:

```bash
# 1. Authenticate to Boundary as yourself
BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD=password \
  boundary authenticate password -addr http://boundary.localhost:9200 \
  -auth-method-id <lab-auth> -login-name dba-user

# 2. Open a brokered MySQL session to the target
boundary connect mysql -addr http://boundary.localhost:9200 -target-id <mariadb-secure-access>
```

The `<lab-auth>` and `<mariadb-secure-access>` IDs are printed by `hal boundary mariadb enable`.

## Observe
Describe the proof from `{{primary.observable.what}}`: Boundary opens a session to the target and
injects a fresh, Vault-minted MySQL credential (role `dba-role`) into the connection. The user is
connected to the database without ever being shown a password; the credential is short-lived and
auto-revokes when the Vault lease expires. If `observable.linkFrom` is null there is no live link to
resolve — keep this to the observed behavior.

## Under the hood
Explain the mechanism grounded in the corpus, broken into key components, attaching the single most
relevant source link inline to each one (a specific doc section, tutorial step, API endpoint, or video
timestamp) so the reader can jump straight to the reinforcing material:
- **Boundary credential brokering** — Boundary stores a Vault token (credential store) and a credential
  library pointing at `database/creds/dba-role`, and injects the result into the session. ([source])
- **Vault database secrets engine** — Vault mints a just-in-time MariaDB credential per request rather
  than handing out a shared password. ([source])
- **Identity-based access (no secret zero)** — the user authenticates to Boundary as themselves; the
  database secret is never distributed to them. ([source])
- **Leases & auto-revocation** — the Vault lease drives automatic revocation when the session/lease
  ends. ([source])

Each `[source]` is the closest-matching corpus entry. If none matches a component, explain it plainly
and omit the link rather than inventing one.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design,
validated-pattern, video), each linking to a real corpus entry. This is the broad recap; the inline
citations above are the targeted, per-component links. Prefer one strong card per type.
