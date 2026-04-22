<!-- hal-plus-spec
{
  "id": "vault_product",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "product",
  "title": "Vault in HAL",
  "summary": "Local Vault CE or Enterprise in dev mode with root token defaults, plus scenario labs for audit, JWT, OIDC, Kubernetes, LDAP, and database secrets.",
  "priority": 40,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault",
    "component": "vault",
    "verifyComponent": "vault",
    "planIntent": "vault product overview"
  },
  "match": {
    "any": [
      "vault",
      "hal vault",
      "vault ce",
      "vault enterprise",
      "vault ent",
      "secret zero",
      "vso",
      "vault audit"
    ],
    "all": []
  },
  "helpCommand": ["vault"],
  "statusCommands": [
    "hal status",
    "hal vault status"
  ],
  "actionCommands": [
    "hal vault status",
    "hal vault create",
    "hal vault create --edition ent",
    "hal obs create",
    "hal vault obs create"
  ],
  "verifyCommands": [
    "hal vault status",
    "curl -s http://vault.localhost:8200/v1/sys/health"
  ],
  "resources": [
    {
      "title": "Vault Docs",
      "href": "https://developer.hashicorp.com/vault",
      "kind": "official",
      "description": "Official Vault product documentation."
    },
    {
      "title": "Vault Kubernetes Auth Method",
      "href": "https://developer.hashicorp.com/vault/docs/auth/kubernetes",
      "kind": "official",
      "description": "Configure the Kubernetes auth method for service account based login flows."
    },
    {
      "title": "Validated Patterns: Vault",
      "href": "https://developer.hashicorp.com/validated-patterns/vault",
      "kind": "guide",
      "description": "Reference patterns for real-world Vault architectures and operations."
    },
    {
      "title": "Vault Operating Guide: Adoption",
      "href": "https://developer.hashicorp.com/validated-designs/vault-operating-guides-adoption",
      "kind": "guide",
      "description": "Adoption guidance for platform teams operating Vault."
    },
    {
      "title": "Vault Operating Guide: Scaling",
      "href": "https://developer.hashicorp.com/validated-designs/vault-operating-guides-scaling",
      "kind": "guide",
      "description": "Scaling guidance for Vault architecture and operations."
    },
    {
      "title": "Vault Operating Guide: Standardization",
      "href": "https://developer.hashicorp.com/validated-designs/vault-operating-guides-standardization",
      "kind": "guide",
      "description": "Standardization guidance for policies, processes, and platform controls."
    },
    {
      "title": "Vault Enterprise Solution Design Guide",
      "href": "https://developer.hashicorp.com/validated-designs/vault-solution-design-guides-vault-enterprise",
      "kind": "guide",
      "description": "Enterprise solution design recommendations for Vault at scale."
    },
    {
      "title": "Vault Observability at Scale",
      "href": "https://www.hashicorp.com/en/blog/hashicorp-vault-observability-monitoring-vault-at-scale",
      "kind": "guide",
      "description": "Monitoring and observability best practices for Vault."
    }
  ],
  "uiLinks": [
    {
      "title": "Vault UI",
      "href": "http://vault.localhost:8200"
    },
    {
      "title": "Grafana",
      "href": "http://grafana.localhost:3000"
    },
    {
      "title": "Prometheus",
      "href": "http://prometheus.localhost:9090"
    },
    {
      "title": "Loki",
      "href": "http://loki.localhost:3100/ready"
    }
  ],
  "focusBullets": [
    "HAL creates Vault in dev mode by default with root token set to root.",
    "Vault Enterprise features require --edition ent and VAULT_LICENSE.",
    "Scenario labs build full local stacks: JWT (GitLab), OIDC (Keycloak), K8s (KinD + VSO), LDAP, and database secrets.",
    "Vault observability artifacts use explicit lifecycle commands: hal vault obs create/update/delete/status."
  ],
  "notes": [
    "For Enterprise mode, export VAULT_LICENSE before running hal vault create --edition ent.",
    "For Vault monitoring, run hal obs create first then hal vault obs create.",
    "Use hal vault obs update/delete/status for lifecycle management.",
    "Audit logging can be shipped to Loki with hal vault audit --enable --loki using the shared audit volume path /vault/logs/audit.log.",
    "K8s CSI demo mode requires Vault Enterprise; the command downgrades to native mode automatically on OSS.",
    "JWT role guardrails in the lab are bound to GitLab project root/secret-zero and protected tags matching v*.",
    "Database dynamic credentials are configured with role dba-role and can be reused by Boundary workflows."
  ],
  "samplePrompts": [
    "How do I deploy Vault CE versus Enterprise in HAL?",
    "What Vault labs are available in HAL?",
    "How does Vault observability wiring work with Grafana, Prometheus, and Loki?"
  ]
}
-->

# Vault in HAL

Use this pack when the user asks about Vault product-level behavior, CE versus Enterprise choices, or available Vault lab scenarios.

## Ground Truth

- `hal vault create` starts Vault in dev mode and sets root token to `root`.
- Enterprise-specific features require `hal vault create --edition ent` and `VAULT_LICENSE` in the environment.
- For monitoring, run `hal obs create` first, then `hal vault obs create`.
- Use explicit lifecycle commands for Vault observability artifacts: `hal vault obs create|update|delete|status`.
- Scenario stacks are intentionally full workflows, not just isolated auth mount toggles.

## CE versus Enterprise Framing

- Vault CE supports the full baseline lab and most scenario flows.
- Enterprise is required for Sentinel policy demonstrations (RGP/EGP) and for Kubernetes CSI-based VSO secret projection mode in this lab.
- When users request Enterprise-only behavior on CE, explain the fallback explicitly and provide the exact Enterprise enable path.

## Scenario Coverage Summary

- Audit: `hal vault audit` for audit sink lifecycle and Loki shipping.
- JWT: `hal vault jwt` for local GitLab CI JWT auth and strict bound claims.
- OIDC: `hal vault oidc` for Keycloak human SSO and group-to-policy mapping.
- K8s: `hal vault k8s` for KinD + VSO with native sync and optional CSI mode.
- LDAP: `hal vault ldap` for auth plus LDAP secrets engine dynamic/static/library examples.
- Database: `hal vault database` for dynamic database credentials and JIT leases.

## HAL MCP Rule

- Runtime status, command syntax, and verification paths should come from HAL MCP first.
- This file captures stable behavior framing and learning objectives, not live runtime truth.
