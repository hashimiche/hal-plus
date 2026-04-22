<!-- hal-plus-spec
{
  "id": "terraform_product",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "product",
  "title": "Terraform Enterprise in HAL",
  "summary": "Local Terraform Enterprise with HTTPS, auto-bootstrap, and optional observability wiring.",
  "priority": 30,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_status",
    "helpTopic": "terraform",
    "component": "terraform",
    "verifyComponent": "terraform",
    "planIntent": "terraform enterprise overview"
  },
  "match": {
    "any": [
      "terraform enterprise",
      " hal terraform",
      "hal tf ",
      "hal tf",
      "tfe"
    ],
    "all": []
  },
  "helpCommand": ["terraform"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal capacity"
  ],
  "actionCommands": [
    "hal capacity",
    "export TFE_LICENSE='your_license_string'",
    "hal terraform create"
  ],
  "verifyCommands": [
    "hal terraform status",
    "curl -k -I https://tfe.localhost:8443/_health_check",
    "curl -k -I https://tfe.localhost:8443/app"
  ],
  "resources": [
    {
      "title": "Terraform Enterprise Docs",
      "href": "https://developer.hashicorp.com/terraform/enterprise",
      "kind": "official",
      "description": "Official Terraform Enterprise product documentation."
    },
    {
      "title": "Terraform Workflows Overview",
      "href": "https://www.hashicorp.com/en/blog/which-terraform-workflow-should-i-use-vcs-cli-or-api",
      "kind": "guide",
      "description": "When to choose VCS, CLI, or API workflows."
    },
    {
      "title": "Terraform Validated Patterns",
      "href": "https://developer.hashicorp.com/validated-patterns/terraform",
      "kind": "guide",
      "description": "Reference architectures and repeatable Terraform patterns."
    },
    {
      "title": "Terraform Enterprise Solution Design Guide",
      "href": "https://developer.hashicorp.com/validated-designs/terraform-solution-design-guides-terraform-enterprise",
      "kind": "guide",
      "description": "Design guidance for Terraform Enterprise adoption and operations."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI",
      "href": "https://tfe.localhost:8443"
    },
    {
      "title": "Grafana",
      "href": "http://grafana.localhost:3000"
    },
    {
      "title": "Prometheus",
      "href": "http://prometheus.localhost:9090"
    }
  ],
  "focusBullets": [
    "TFE requires TFE_LICENSE before hal terraform create can boot.",
    "TFE is one of the heaviest HAL deployments, so hal capacity is the first check.",
    "HAL exposes TFE at https://tfe.localhost:8443 with a self-signed certificate.",
    "Deploy auto-creates the initial admin user and caches an application API token."
  ],
  "notes": [
    "HAL-first path is hal terraform create, hal terraform vcs-workflow enable, and hal terraform api-workflow depending on workflow type.",
    "The browser will show a self-signed certificate warning; accept the risk to reach the UI.",
    "Deploy auto-bootstraps the admin account haladmin / hal9000FTW unless overridden by flags.",
    "When deploy completes successfully, HAL caches the application token at ~/.hal/tfe-app-api-token.",
    "Use explicit lifecycle commands for Terraform observability: hal terraform obs create, hal terraform obs update, hal terraform obs delete, hal terraform obs status.",
    "hal terraform obs create expects the obs stack to already be running; run hal obs create first if needed."
  ],
  "samplePrompts": [
    "How do I deploy Terraform Enterprise in HAL?",
    "What URLs should I use for TFE and observability?",
    "Does the HAL TFE lab need a license?"
  ]
}
-->

# Terraform Enterprise in HAL

Use this pack when the user is asking about Terraform Enterprise, `hal terraform`, or `hal tf` at a product level.

## Ground Truth

- `hal terraform create` enforces `TFE_LICENSE` before boot.
- `hal capacity` should be part of the answer because TFE is a high-consumption deployment.
- HAL exposes the UI at `https://tfe.localhost:8443` through the local proxy.
- The browser must accept the self-signed certificate risk before the UI is usable.
- Deploy bootstraps an admin account automatically and caches an app API token at `~/.hal/tfe-app-api-token`.
- If `hal obs deploy` is already active, register Terraform observability artifacts with `hal terraform obs create`.

## Workflow Choices

- VCS-driven flow: `hal terraform vcs-workflow enable`.
- API helper flow: `hal terraform api-workflow`.
- Verification should stay HAL-first before low-level container commands.

## Educational Framing

- Use VCS-driven flow when the lesson is repo integration, remote runs, and GitLab-based change validation.
- Use CLI-driven flow when the lesson is Terraform CLI ergonomics, `tfx`, and remote execution without changing the host trust store.

## MCP Rule

- Runtime TFE status, current endpoints, current help/flags, and verification paths should come from HAL MCP first.
- This file keeps the workflow framing and stable lab knowledge, not the authoritative runtime state.
