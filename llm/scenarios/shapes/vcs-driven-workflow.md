<!-- hal-plus-scenario
{
  "id": "vcs-driven-workflow",
  "title": "VCS-driven workflow",
  "priority": 90,
  "intent": {
    "any": [
      "vcs driven",
      "vcs-driven",
      "vcs workflow",
      "version control workflow",
      "understand vcs",
      "walk me through",
      "end to end",
      "end-to-end",
      "how does the workflow",
      "git driven",
      "commit triggers"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "tfe_vcs_workflow",
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

# Scenario shape: VCS-driven workflow

This is an **exemplar** narrative skeleton. The composer fills each slot from the data source declared
in the spec block above, for *any* capability whose subgraph matches `appliesTo` — not just the VCS
exemplar. Keep the prose grounded: every command comes from the capability graph or MCP, every link
comes from MCP or the corpus, and all live values (URLs, credentials, run links) come from the MCP
status tool. Do not invent commands or URLs.

## Overview
One or two sentences naming the capability (`{{primary.label}}`) and what it lets the user accomplish
end to end. Anchor the rest of the answer: "Here's how to stand it up, drive it, and what's happening
underneath." Pull conceptual framing from the corpus when available; otherwise summarize from
`{{primary.provides}}`.

## Provision
List the commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`.
Each line is a real `hal` command from a capability node — never paraphrased. For the VCS exemplar:

```bash
hal terraform create            # brings up TFE (capability: tfe)
hal terraform vcs-workflow enable   # boots GitLab + links the workspace (capabilities: gitlab, tfe_vcs_workflow)
```

## Access
Surface the live endpoints and lab credentials the user needs, read from the status tool fields named
in `access.surfaces` and `access.credentials`. Present credentials plainly — they are lab/demo,
non-secret, and already printed by the CLI. Example fields for the VCS exemplar: GitLab repo
(`gitlab.web_url`, login `lab_credentials.gitlab`) and the TFE workspace (`tfe.workspace_url`, admin
`lab_credentials.tfe_admin`).

## Trigger
State the single manual action that activates the observable, taken verbatim from
`{{primary.manualTrigger}}`. For the VCS exemplar: push a commit to the `main` branch of the GitLab
repo.

## Observe
Tell the user exactly what they will see and where, using `{{primary.observable.what}}` and the link
resolved from `{{primary.observable.linkFrom}}` (the dotted path into the MCP payload). For the VCS
exemplar: a webhook fires, TFE queues and auto-applies a run, and the latest run appears at the top of
the workspace runs page (`tfe.runs_url`).

## Under the hood
Explain the mechanism grounded in the retrieved corpus, with at least one chunk per source type in
`coverage` (docs + tutorial + validated-design + video). Break it into the key components and, for each
one, attach the single most relevant source link inline so the reader can jump straight to the
reinforcing material (a specific doc section, tutorial step, API endpoint, or video timestamp) — not just
a generic recap. For the VCS exemplar:
- **OAuth client link** — TFE authenticates to GitLab. ([source])
- **Webhook** — GitLab delivers push events to TFE. ([source])
- **`queue-all-runs` + `auto-apply`** — the push event becomes an applied run. ([source])
- **`execution-mode: remote`** — the plan/apply executes on TFE. ([source])

Each `[source]` is the closest-matching corpus entry for that component. If no corpus entry matches a
component, explain it plainly and omit the link rather than inventing one. Cite concepts from the
evidence, not invented detail.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design, validated-pattern,
video), each linking to a real corpus entry. This is the broad recap; the inline citations above are the
targeted, per-component links. Prefer one strong card per type over many duplicates.
