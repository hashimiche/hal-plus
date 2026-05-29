<!-- hal-plus-scenario
{
  "id": "dynamic-secrets",
  "title": "Dynamic secrets",
  "priority": 85,
  "intent": {
    "any": [
      "dynamic secret",
      "dynamic secrets",
      "dynamic database",
      "database credential",
      "database credentials",
      "short-lived credential",
      "short lived credential",
      "just in time",
      "just-in-time",
      "jit credential",
      "rotate credential",
      "secrets engine"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "vault_database",
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

# Scenario shape: Dynamic secrets

A **request-and-consume** exemplar: instead of a long-lived static secret, the user provisions a
secrets engine and then *requests* a fresh, short-lived credential on demand. The same 7 slots apply —
here "Trigger" is the read that mints a credential and "Observe" is the lease/TTL that auto-revokes it.
Keep prose grounded: commands come from the capability graph, the credential request comes from
`{{primary.manualTrigger}}`, and TTL/lease behavior is described from the corpus and capability notes,
not invented.

## Overview
Name the capability (`{{primary.label}}`) and the security idea in a sentence or two: short-lived,
on-demand credentials with no shared static password. Pull conceptual framing from the corpus when
available; otherwise summarize from `{{primary.provides}}`.

## Provision
List the commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`.
For the dynamic-database exemplar:

```bash
hal vault create               # brings up Vault (capability: vault)
hal vault database enable      # deploys MariaDB + mounts the database/ secrets engine (capability: vault_database)
```

## Access
Surface where the engine and backing database live. When the status tool only returns text status (no
structured payload, as with `get_vault_database_status`), describe the known endpoints from the
capability notes rather than a dotted path — e.g. MariaDB at `mariadb.localhost:3306`, Vault mount
`database/`, role `dba-role`. Do not fabricate field paths that the status tool does not return.

## Trigger
State the single action that mints a credential, taken from `{{primary.manualTrigger}}`. For the
dynamic-database exemplar: `vault read database/creds/dba-role`.

## Observe
Describe the proof from `{{primary.observable.what}}`: Vault returns a fresh username/password, valid
for a short TTL (2m default, 2h max for `dba-role`), that self-revokes when the lease expires. If
`observable.linkFrom` is null there is no live link to resolve — keep this to the observed behavior.

## Under the hood
Explain the mechanism grounded in the corpus, broken into key components, attaching the single most
relevant source link inline to each one (a specific doc section, tutorial step, API endpoint, or video
timestamp) so the reader can jump straight to the reinforcing material:
- **Database secrets engine** — Vault manages credentials for the database. ([source])
- **Root rotation** — Vault rotates the least-privileged admin password so nobody knows it. ([source])
- **Creation / revocation SQL** — per-request users are created and dropped via configured statements. ([source])
- **Leases & TTLs** — the lease drives automatic revocation when it expires. ([source])

Each `[source]` is the closest-matching corpus entry. If none matches a component, explain it plainly
and omit the link rather than inventing one.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design,
validated-pattern, video), each linking to a real corpus entry. This is the broad recap; the inline
citations above are the targeted, per-component links. Prefer one strong card per type.
