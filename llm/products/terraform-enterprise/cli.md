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
    "statusTool": "get_tfe_cli_status",
    "helpTopic": "terraform cli",
    "component": "terraform_cli",
    "verifyComponent": "terraform_cli",
    "planIntent": "terraform cli helper workflow"
  },
  "match": {
    "any": [
      "hal terraform cli",
      "hal tf cli",
      "terraform cli",
      "tfx",
      "helper container",
      "cli workflow",
      "terraform login",
      "remote execution from cli"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "cli"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal terraform cli",
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
    "hal tf cli -e",
    "hal tf cli -c"
  ],
  "verifyCommands": [
    "hal terraform cli",
    "hal tf cli -c",
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
    "Build with hal tf cli -e, then enter with hal tf cli -c.",
    "The helper flow mints auth, writes .tfx.hcl and Terraform credentials, and avoids host trust-store changes.",
    "Default org is hal and the scenario workspaces are spread across projects Dave and Frank."
  ],
  "notes": [
    "The helper image is designed for local TFE workflows without teaching the user to change the host trust store.",
    "hal tf cli -c refreshes auth before opening the shell and seeds the default workspaces if they are missing.",
    "HAL ensures scenario projects Dave and Frank and the default hal-* workspace set inside org hal.",
    "The default scenario workspaces are hal-lucinated, hal-lelujah, and hal-ibut in Dave plus hal-ogen and hal-oween in Frank.",
    "The helper bootstrap authenticates with the admin account and creates a token for CLI use inside the container.",
    "If the helper is stale, reset with hal tf cli --disable --force and rebuild with hal tf cli -e -f."
  ],
  "samplePrompts": [
    "I want the CLI-driven TFE workflow",
    "How do I use terraform and tfx against local TFE?",
    "What does hal tf cli -c set up for me?"
  ]
}
-->

# Terraform Enterprise CLI Flow

Use this pack when the user wants the dedicated helper shell for Terraform CLI and `tfx`.

## Operator Rules

- Prefer the short path `hal tf cli -e && hal tf cli -c` when the question is about getting started quickly.
- Mention that HAL writes auth and trust inside the helper container before the shell opens.
- Mention the seeded scenario projects and workspaces because that is one of the immediate visible outcomes in the UI.
- Current helper state and verification commands should come from HAL MCP when available.
