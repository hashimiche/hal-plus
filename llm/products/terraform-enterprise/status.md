<!-- hal-plus-spec
{
  "id": "terraform_status",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "status",
  "title": "Check Terraform Enterprise Status",
  "summary": "Verify TFE health, endpoint readiness, and whether the stack is up before deeper troubleshooting.",
  "priority": 75,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_status",
    "helpTopic": "terraform status",
    "component": "terraform",
    "verifyComponent": "terraform"
  },
  "match": {
    "any": [
      "hal terraform status",
      "terraform status",
      "tfe status",
      "is tfe up",
      "is tfe running",
      "tfe running",
      "check tfe",
      "tfe health"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "status"],
  "statusCommands": [
    "hal status",
    "hal terraform status",
    "hal capacity"
  ],
  "actionCommands": [
    "hal terraform status"
  ],
  "verifyCommands": [
    "hal status",
    "hal terraform status",
    "curl -k -I https://tfe.localhost:8443/_health_check",
    "curl -k -I https://tfe.localhost:8443/app"
  ],
  "resources": [
    {
      "title": "Terraform Enterprise Docs",
      "href": "https://developer.hashicorp.com/terraform/enterprise",
      "kind": "official",
      "description": "Product reference."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI",
      "href": "https://tfe.localhost:8443"
    }
  ],
  "focusBullets": [
    "Use hal terraform status as the product-specific readiness check.",
    "Use curl -k on the proxied HTTPS endpoint when you need an explicit reachability proof."
  ],
  "notes": [
    "Status answers should stay concise and deterministic.",
    "If the stack is down, recommend hal terraform deploy after checking capacity and license prerequisites.",
    "If the UI is unreachable but deploy supposedly finished, validate both _health_check and /app on https://tfe.localhost:8443."
  ],
  "samplePrompts": [
    "Is TFE running?",
    "How do I verify the local TFE UI is healthy?"
  ]
}
-->

# Terraform Enterprise Status

Use this pack for readiness and health questions before describing VCS or CLI workflows.

## Operator Rules

- Prefer `hal terraform status` before low-level debugging.
- For browser problems, include the proxied HTTPS checks and remind the user about the self-signed certificate warning.
- Status wording should be based on HAL MCP output, not static assumptions.
