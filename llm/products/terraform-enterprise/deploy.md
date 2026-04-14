<!-- hal-plus-spec
{
  "id": "terraform_deploy",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "deploy",
  "title": "Deploy Terraform Enterprise",
  "summary": "Bring up the local TFE stack with license enforcement, HTTPS, and optional observability backfill.",
  "priority": 90,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_status",
    "helpTopic": "terraform deploy",
    "component": "terraform",
    "verifyComponent": "terraform",
    "planIntent": "deploy terraform enterprise"
  },
  "match": {
    "any": [
      "hal terraform deploy",
      "terraform deploy",
      "deploy terraform enterprise",
      "deploy tfe",
      "bring up tfe",
      "tfe license",
      "install tfe"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "deploy"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal capacity"
  ],
  "preflightChecks": [
    {
      "title": "Check local capacity first",
      "why": "Terraform Enterprise is one of the heaviest HAL deployments.",
      "commands": [
        "hal capacity"
      ]
    },
    {
      "title": "Export a valid TFE license",
      "why": "hal terraform deploy refuses to boot without TFE_LICENSE in the environment.",
      "commands": [
        "export TFE_LICENSE='your_license_string'"
      ]
    }
  ],
  "actionCommands": [
    "hal capacity",
    "export TFE_LICENSE='your_license_string'",
    "hal terraform deploy"
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
      "description": "Official product documentation."
    },
    {
      "title": "Terraform Enterprise Solution Design Guide",
      "href": "https://developer.hashicorp.com/validated-designs/terraform-solution-design-guides-terraform-enterprise",
      "kind": "guide",
      "description": "Deployment and operating model guidance."
    },
    {
      "title": "Terraform Adoption Operating Guide",
      "href": "https://developer.hashicorp.com/validated-designs/terraform-operating-guides-adoption",
      "kind": "guide",
      "description": "Adoption guide for Terraform platform workflows."
    },
    {
      "title": "Terraform Scaling Operating Guide",
      "href": "https://developer.hashicorp.com/validated-designs/terraform-operating-guides-scaling",
      "kind": "guide",
      "description": "Scaling and platform operations guidance."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI",
      "href": "https://tfe.localhost:8443"
    },
    {
      "title": "MinIO API",
      "href": "http://127.0.0.1:19000"
    },
    {
      "title": "MinIO Console",
      "href": "http://127.0.0.1:19001"
    }
  ],
  "focusBullets": [
    "Deploy waits on the proxied HTTPS health endpoint and can take several minutes.",
    "HAL automatically creates the initial admin user and foundation org/project wiring.",
    "Use hal terraform deploy --configure-obs only after the observability stack is already running."
  ],
  "notes": [
    "User-facing URL remains https://tfe.localhost:8443 behind hal-tfe-proxy.",
    "HAL validates both _health_check and /app style access so redirect loops are caught early.",
    "The deploy path patches in-container trust and task-worker cache behavior so remote runs keep working locally.",
    "After deploy, tell the user to accept the browser warning for the self-signed certificate.",
    "Admin defaults are haladmin / hal9000FTW unless the operator overrides flags.",
    "If observability is up first, metrics and the Grafana dashboard are wired automatically during deploy."
  ],
  "samplePrompts": [
    "Deploy TFE for me",
    "Why is hal terraform deploy failing before startup?",
    "How do I wire observability after TFE is already running?"
  ]
}
-->

# Terraform Enterprise Deploy

Use this pack when the user wants to boot, re-boot, or explain the Terraform Enterprise base stack.

## Key Operator Rules

- Mention `hal capacity` before deployment because TFE is resource intensive.
- Be explicit that `TFE_LICENSE` is mandatory.
- State that the HTTPS endpoint is `https://tfe.localhost:8443` and the certificate is self-signed.
- If observability comes later, the refresh action is `hal terraform deploy --configure-obs`, not a full redeploy by default.
- Pull current deploy syntax, current endpoint context, and verification commands from HAL MCP when available.
