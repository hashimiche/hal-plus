<!-- hal-plus-spec
{
  "id": "vault_obs",
  "product": "vault",
  "productLabel": "Vault",
  "subcommand": "obs",
  "title": "Vault Observability Wiring",
  "summary": "Wire Vault into the HAL observability stack (Prometheus + Grafana + Loki). Requires the obs stack to be running first.",
  "priority": 85,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_vault_status",
    "helpTopic": "vault obs",
    "component": "vault",
    "verifyComponent": "vault",
    "planIntent": "vault observability wiring"
  },
  "match": {
    "any": [
      "vault metrics",
      "vault monitoring",
      "vault obs",
      "vault observability",
      "vault grafana",
      "vault prometheus",
      "vault loki",
      "check vault metrics",
      "vault audit log",
      "vault obs create",
      "vault obs status"
    ],
    "all": []
  },
  "helpCommand": ["vault", "obs"],
  "statusCommands": [
    "hal vault obs status",
    "hal obs status"
  ],
  "actionCommands": [
    "hal obs create",
    "hal vault obs create",
    "hal vault obs status"
  ],
  "verifyCommands": [
    "hal vault status",
    "hal obs status"
  ],
  "resources": [
    {
      "title": "Vault Observability at Scale",
      "href": "https://www.hashicorp.com/en/blog/hashicorp-vault-observability-monitoring-vault-at-scale",
      "kind": "official",
      "description": "Monitoring and observability best practices for Vault."
    },
    {
      "title": "Vault Telemetry Reference",
      "href": "https://developer.hashicorp.com/vault/docs/configuration/telemetry",
      "kind": "official",
      "description": "Vault telemetry configuration for Prometheus, StatsD, and other backends."
    }
  ],
  "uiLinks": [
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
    "Run hal obs create first to start Prometheus, Grafana, and Loki.",
    "Then run hal vault obs create to wire Vault metrics and audit logs into the stack."
  ],
  "notes": [
    "Vault audit logs can be shipped to Loki with hal vault audit --enable --loki.",
    "Use hal vault obs update/delete/status for lifecycle management after initial wiring."
  ],
  "samplePrompts": [
    "I want to check vault metrics",
    "How do I wire Vault into Grafana?",
    "How do I enable Vault observability in HAL?"
  ]
}
-->

# Vault Observability Wiring

Use this pack when the user asks about Vault metrics, monitoring, observability stack wiring, Prometheus/Grafana/Loki integration, or audit log shipping.

## Ground Truth

- The observability stack (Prometheus + Grafana + Loki) must be running before wiring Vault into it.
- Start the stack with `hal obs create`, then wire Vault with `hal vault obs create`.
- Use `hal vault obs status` to confirm the wiring is active and metrics are being scraped.
- Audit logs can be shipped to Loki separately with `hal vault audit --enable --loki`.

## Lab Surfaces

- Grafana: http://grafana.localhost:3000
- Prometheus: http://prometheus.localhost:9090
