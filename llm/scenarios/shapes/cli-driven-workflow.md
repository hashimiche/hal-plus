<!-- hal-plus-scenario
{
  "id": "cli-driven-workflow",
  "title": "API/CLI-driven workflow",
  "priority": 80,
  "intent": {
    "any": [
      "api driven",
      "api-driven",
      "cli driven",
      "cli-driven",
      "api workflow",
      "without vcs",
      "no vcs",
      "drive runs via api",
      "drive runs with the api",
      "tfx",
      "programmatically"
    ],
    "all": []
  },
  "appliesTo": {
    "capabilityKind": "feature",
    "requires": ["manualTrigger", "observable"]
  },
  "primaryCapabilityHint": "tfe_api_workflow",
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

# Scenario shape: API/CLI-driven workflow

The counterpart to the VCS-driven workflow: the user drives Terraform runs from an API/CLI helper
instead of a git push. Same 7 slots — "Trigger" is a command issued from the helper shell, and
"Observe" is the run that lands in the workspace without any VCS webhook. This shape also exercises
**graph reuse**: its capability `dependsOn` the shared `tfe` node, so the provision walk composes the
TFE bring-up with the helper enablement.

## Overview
Name the capability (`{{primary.label}}`) and contrast it with the VCS path: here runs are queued
programmatically via the API/CLI rather than triggered by a commit. Pull framing from the corpus when
available; otherwise summarize from `{{primary.provides}}`.

## Provision
List commands in dependency order by walking `{{primary.dependsOn}}` then `{{primary.action}}`:

```bash
hal terraform create               # brings up TFE (capability: tfe)
hal terraform api-workflow enable   # builds + runs the ephemeral TFX helper shell (capability: tfe_api_workflow)
```

## Access
Surface the TFE workspace endpoint and admin login from the `tfe` node's structured status
(URL resolved from `tfe.workspace_url`, admin resolved from `lab_credentials.tfe_admin` via
`get_tfe_status` — print the resolved values, not the paths). The helper itself
(`get_tfe_api_workflow_status`) returns text status, so describe the helper container
(`hal-tfe-api`) from the capability notes rather than a dotted path.

## Trigger
State the action from `{{primary.manualTrigger}}`: from inside the helper shell, drive a workspace and
queue a run using tfx / the TFE API.

## Observe
Describe the proof from `{{primary.observable.what}}`: a run appears in the TFE workspace, queued via
the API/CLI rather than a VCS webhook. `observable.linkFrom` is null here, so keep this to the observed
behavior plus the workspace URL (resolved from `tfe.workspace_url`) already surfaced in Access.

## Under the hood
Explain the mechanism grounded in the corpus, broken into key components, attaching the single most
relevant source link inline to each one (a specific doc section, tutorial step, API endpoint, or video
timestamp) so the reader can jump straight to the reinforcing material:
- **Configuration version** — the CLI/API client (tfx) uploads config to create a new version. ([source])
- **Run API** — a run is queued against the workspace via the TFE run API. ([source])
- **Remote execution** — the plan/apply executes on TFE, contrasted with the VCS webhook path. ([source])

Each `[source]` is the closest-matching corpus entry. If none matches a component, explain it plainly
and omit the link rather than inventing one.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design,
validated-pattern, video), each linking to a real corpus entry. This is the broad recap; the inline
citations above are the targeted, per-component links. Prefer one strong card per type.
