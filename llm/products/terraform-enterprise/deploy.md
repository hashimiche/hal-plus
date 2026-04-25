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
    "helpTopic": "terraform create",
    "component": "terraform",
    "verifyComponent": "terraform",
    "planIntent": "create terraform enterprise"
  },
  "match": {
    "any": [
      "hal terraform create",
      "terraform create",
      "create terraform enterprise",
      "create tfe",
      "bring up tfe",
      "tfe license",
      "install tfe"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "create"],
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
      "why": "hal terraform create refuses to boot without TFE_LICENSE in the environment.",
      "commands": [
        "export TFE_LICENSE='your_license_string'"
      ]
    }
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
      "title": "TFE Deploy Documentation",
      "href": "https://developer.hashicorp.com/terraform/enterprise/deploy",
      "kind": "official",
      "description": "Deployment options, requirements, and architecture overview."
    },
    {
      "title": "TFE License Requirements",
      "href": "https://developer.hashicorp.com/terraform/enterprise/requirements/license",
      "kind": "official",
      "description": "License format, validation, and environment variable requirements."
    },
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
    "Terraform observability artifacts are managed separately: use hal terraform obs create after hal obs create."
  ],
  "notes": [
    "User-facing URL remains https://tfe.localhost:8443 behind hal-tfe-proxy.",
    "HAL validates both _health_check and /app style access so redirect loops are caught early.",
    "The deploy path patches in-container trust and task-worker cache behavior so remote runs keep working locally.",
    "After deploy, tell the user to accept the browser warning for the self-signed certificate.",
    "Admin defaults are haladmin / hal9000FTW unless the operator overrides flags.",
    "Terraform observability is not auto-wired at deploy time; use hal terraform obs create after hal obs create."
  ],
  "samplePrompts": [
    "Create TFE for me",
    "Why is hal terraform create failing before startup?",
    "How do I wire observability after TFE is already running?"
  ]
}
-->

TFE is an enterprise product — it **requires a valid `TFE_LICENSE` string** in the environment before `hal terraform create` will even attempt to start the containers.

### License and preflight

```shell
# Set the license before any deploy command
export TFE_LICENSE='<your_license_string>'

# Check you have enough resources (TFE is one of the heaviest HAL deployments)
hal capacity
```

### What gets created

- TFE application container behind `hal-tfe-proxy` (HTTPS on `https://tfe.localhost:8443`)
- MinIO for object storage (`http://127.0.0.1:19000` API, `http://127.0.0.1:19001` console)
- PostgreSQL for the TFE database
- Redis for the task worker cache
- Initial admin user: `haladmin` / `hal9000FTW` (unless overridden)
- Foundation org `hal` and initial project/workspace wiring via HAL bootstrap

### Verify the deployment

```shell
# HAL-first check — confirms containers, health endpoint, and HTTPS reachability
hal terraform status

# Direct health check against the proxied HTTPS endpoint
curl -k -I https://tfe.localhost:8443/_health_check
# Expect: HTTP/2 200

# Confirm app redirect works (catches proxy misconfiguration)
curl -k -I https://tfe.localhost:8443/app
```

### Deploy a second TFE instance (twin)

```shell
# Reuses the same MinIO/Redis/PostgreSQL ecosystem
hal terraform create --twin
hal terraform status
```

### Add observability (not auto-wired at deploy time)

```shell
# Observability stack must be deployed first, then TFE wired into it
hal obs create
hal terraform obs create
```

The TFE certificate is self-signed — accept the browser warning on first access to `https://tfe.localhost:8443`.
