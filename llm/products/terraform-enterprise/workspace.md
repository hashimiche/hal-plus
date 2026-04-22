<!-- hal-plus-spec
{
  "id": "terraform_workspace",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "workspace",
  "title": "VCS-Driven Workspace Flow",
  "summary": "Bootstrap the GitLab-backed workspace demo and validate remote runs through repository changes.",
  "priority": 95,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_status",
    "helpTopic": "terraform vcs-workflow",
    "component": "terraform_vcs_workflow",
    "verifyComponent": "terraform_vcs_workflow",
    "planIntent": "setup terraform vcs workflow"
  },
  "match": {
    "any": [
      "vcs",
      "hal terraform vcs-workflow",
      "hal terraform vcs-workflow enable",
      "terraform vcs-workflow",
      "tfe vcs-workflow",
      "bootstrap vcs-workflow",
      "bootstrap a vcs workflow",
      "vcs workflow",
      "vcs-driven",
      "vcs driven",
      "vcs-driven workflow",
      "vcs driver workflow",
      "vcs driver",
      "driver workflow",
      "gitlab",
      "workspace wiring",
      "remote runs from gitlab"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "vcs-workflow"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal capacity"
  ],
  "preflightChecks": [
    {
      "title": "Confirm Terraform Enterprise is already up",
      "why": "Workspace bootstrap assumes the base TFE stack is reachable first.",
      "commands": [
        "hal terraform status"
      ]
    },
    {
      "title": "Recheck local capacity",
      "why": "The VCS-driven path also boots or reuses GitLab, so the lab gets heavier than base TFE alone.",
      "commands": [
        "hal capacity"
      ]
    }
  ],
  "actionCommands": [
    "hal capacity",
    "hal terraform vcs-workflow enable"
  ],
  "verifyCommands": [
    "hal terraform vcs-workflow --help",
    "hal terraform status",
    "curl -k -I https://tfe.localhost:8443/app"
  ],
  "resources": [
    {
      "title": "Terraform Enterprise Docs",
      "href": "https://developer.hashicorp.com/terraform/enterprise",
      "kind": "official",
      "description": "Official product docs."
    },
    {
      "title": "Terraform Enterprise Workspaces",
      "href": "https://developer.hashicorp.com/terraform/enterprise/workspaces",
      "kind": "official",
      "description": "Workspace creation and VCS-backed run model in Terraform Enterprise."
    },
    {
      "title": "Terraform Workflows Overview",
      "href": "https://www.hashicorp.com/en/blog/which-terraform-workflow-should-i-use-vcs-cli-or-api",
      "kind": "guide",
      "description": "When VCS workflows are the right choice."
    },
    {
      "title": "Terraform Standardization Operating Guide",
      "href": "https://developer.hashicorp.com/validated-designs/terraform-operating-guides-standardization",
      "kind": "guide",
      "description": "Standardizing workspace and repo patterns."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI",
      "href": "https://tfe.localhost:8443"
    }
  ],
  "focusBullets": [
    "VCS-driven flow is possible through GitLab with hal terraform vcs-workflow enable.",
    "This path is slow compared with CLI flow because GitLab bootstrap adds time and resource load.",
    "Validation should be described as a commit push to main, not only tag creation."
  ],
  "notes": [
    "Be explicit that GitLab makes this workflow longer to deploy than the pure CLI helper path.",
    "Use hal capacity before starting because TFE plus GitLab is expensive in a local lab.",
    "The default org is hal, and the default workspace bootstrap starts with project Dave unless flags override it.",
    "For first-run validation, tell the user to push a new commit to the tracked branch because tag-only validation is not reliable when the tagged SHA was already ingested.",
    "Keep the answer HAL-first and do not invent raw GitLab bootstrap commands unless the user asks for low-level debugging."
  ],
  "samplePrompts": [
    "I want the GitLab-backed TFE workflow",
    "How do I bootstrap a VCS-driven TFE workspace?",
    "If I want to test VCS driver workflow, what should I do?",
    "Why is hal terraform vcs-workflow enable taking so long?"
  ]
}
-->

# Terraform Enterprise Workspace Flow

Use this pack when the user wants the VCS-driven Terraform Enterprise lab.

## Operator Rules

- Mention GitLab explicitly because it is the reason this flow is slower and heavier.
- Keep validation grounded in a real branch commit flow.
- Prefer `hal terraform vcs-workflow enable` when the question is clearly about workspace bootstrap.
- Pull the current workspace help, trigger guidance, and recommended commands from HAL MCP.
