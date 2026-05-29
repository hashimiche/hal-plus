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
    { "name": "under_the_hood",  "source": "corpus", "coverage": ["docs", "tutorial", "validated-design", "video"] },
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
(`tfe.workspace_url`, `lab_credentials.tfe_admin` via `get_tfe_status`). The helper itself
(`get_tfe_api_workflow_status`) returns text status, so describe the helper container
(`hal-tfe-api`) from the capability notes rather than a dotted path.

## Trigger
State the action from `{{primary.manualTrigger}}`: from inside the helper shell, drive a workspace and
queue a run using tfx / the TFE API.

## Observe
Describe the proof from `{{primary.observable.what}}`: a run appears in the TFE workspace, queued via
the API/CLI rather than a VCS webhook. `observable.linkFrom` is null here, so keep this to the observed
behavior plus the `tfe.workspace_url` already surfaced in Access.

## Under the hood
Explain the mechanism grounded in the corpus, with at least one chunk per `coverage` source type: the
TFE run API, remote execution, and how a CLI/API client (tfx) creates configuration versions and queues
runs — contrasted with the VCS webhook path.

## Learn more
Render typed source cards grouped by `source_type` (docs, tutorial, validated-design,
validated-pattern, video), each linking to a real corpus entry. Prefer one strong card per type.
