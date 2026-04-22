<!-- hal-plus-spec
{
  "id": "terraform_cli",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "cli",
  "title": "CLI-Driven Helper Flow",
  "summary": "Build and enter the helper container that already has terraform, tfx, trust, and auth for local TFE.",
  "priority": 100,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_api_workflow_status",
    "helpTopic": "terraform api-workflow",
    "component": "terraform_api_workflow",
    "verifyComponent": "terraform_api_workflow",
    "planIntent": "terraform api-workflow helper workflow"
  },
  "match": {
    "any": [
      "hal terraform api-workflow",
      "hal tf api-workflow",
      "terraform api-workflow",
      "tfx",
      "helper container",
      "api workflow",
      "terraform login",
      "remote execution from api-workflow"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "api-workflow"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal terraform api-workflow",
    "hal capacity"
  ],
  "preflightChecks": [
    {
      "title": "Confirm Terraform Enterprise is already up",
      "why": "The helper container assumes the local TFE endpoint and cert material exist already.",
      "commands": [
        "hal terraform status"
      ]
    }
  ],
  "actionCommands": [
    "hal terraform api-workflow",
    "hal tf api-workflow enable"
  ],
  "verifyCommands": [
    "hal terraform api-workflow",
    "hal tf api-workflow enable",
    "terraform version",
    "tfx --help",
    "ls /workspaces"
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
      "description": "Workspace model and run behavior for VCS-driven workflows."
    },
    {
      "title": "Terraform Workflows Overview",
      "href": "https://www.hashicorp.com/en/blog/which-terraform-workflow-should-i-use-vcs-cli-or-api",
      "kind": "guide",
      "description": "Why CLI-driven workflows are useful alongside VCS."
    },
    {
      "title": "Terraform Validated Patterns",
      "href": "https://developer.hashicorp.com/validated-patterns/terraform",
      "kind": "guide",
      "description": "Patterns you can try once the helper shell is available."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI",
      "href": "https://tfe.localhost:8443"
    }
  ],
  "focusBullets": [
    "CLI-driven workflow uses a dedicated helper container with terraform and tfx.",
    "Provision and validate with hal terraform api-workflow or hal tf api-workflow enable.",
    "The helper flow mints auth, writes .tfx.hcl and Terraform credentials, and avoids host trust-store changes.",
    "Default org is hal and the scenario workspaces are spread across projects Dave and Frank."
  ],
  "notes": [
    "The helper image is designed for local TFE workflows without teaching the user to change the host trust store.",
    "hal terraform api-workflow refreshes auth and prepares the helper runtime for API-driven exercises.",
    "HAL ensures scenario projects Dave and Frank and the default hal-* workspace set inside org hal.",
    "The default scenario workspaces are hal-lucinated, hal-lelujah, and hal-ibut in Dave plus hal-ogen and hal-oween in Frank.",
    "The helper bootstrap authenticates with the admin account and creates a token for CLI use inside the container.",
    "If the helper is stale, reset with hal tf api-workflow disable --force and rebuild with hal tf api-workflow enable --force."
  ],
  "samplePrompts": [
    "I want the CLI-driven TFE workflow",
    "How do I use terraform and tfx against local TFE?",
    "What does hal terraform api-workflow set up for me?"
  ]
}
-->

# Terraform Enterprise CLI Flow

Use this pack when the user wants the API helper workflow for Terraform CLI and `tfx`.

## Operator Rules

- Prefer `hal terraform api-workflow` (or `hal tf api-workflow enable`) when the question is about getting started quickly.
- Mention that HAL writes auth and trust inside the helper container before the shell opens.
- Mention the seeded scenario projects and workspaces because that is one of the immediate visible outcomes in the UI.
- Current helper state and verification commands should come from HAL MCP when available.
