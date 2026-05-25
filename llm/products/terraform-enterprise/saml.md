<!-- hal-plus-spec
{
  "id": "tfe_saml",
  "product": "terraform",
  "productLabel": "Terraform Enterprise",
  "subcommand": "saml",
  "title": "TFE SAML SSO and SCIM",
  "summary": "Enable Authentik-backed SAML SSO for TFE with optional SCIM provisioning for team membership.",
  "priority": 32,
  "mcp": {
    "baselineTool": "hal_status_baseline",
    "statusTool": "get_tfe_status",
    "helpTopic": "terraform saml",
    "component": "terraform",
    "verifyComponent": "terraform",
    "planIntent": "enable tfe saml"
  },
  "match": {
    "any": [
      "tfe saml",
      "tf saml",
      "terraform saml",
      "hal tf saml",
      "tfe sso",
      "tfe single sign",
      "tfe scim",
      "tfe team provisioning",
      "authentik tfe"
    ],
    "all": []
  },
  "helpCommand": ["terraform", "saml"],
  "statusCommands": [
    "hal tf saml",
    "hal tf status"
  ],
  "actionCommands": [
    "hal tf saml enable",
    "hal tf saml enable --scim"
  ],
  "verifyCommands": [
    "hal tf saml",
    "curl -sk -H \"Authorization: Bearer $TFE_TOKEN\" https://tfe.localhost:8443/api/v2/admin/saml-settings | jq .data.attributes.enabled"
  ],
  "resources": [
    {
      "title": "TFE SAML SSO Docs",
      "href": "https://developer.hashicorp.com/terraform/enterprise/saml/configuration",
      "kind": "official",
      "description": "Official TFE SAML SSO configuration reference."
    },
    {
      "title": "TFE SCIM Docs",
      "href": "https://developer.hashicorp.com/terraform/enterprise/users-teams-organizations/scim",
      "kind": "official",
      "description": "Official TFE SCIM provisioning documentation."
    }
  ],
  "uiLinks": [
    {
      "title": "TFE UI (SSO login)",
      "href": "https://tfe.localhost:8443"
    },
    {
      "title": "Authentik Admin UI",
      "href": "http://authentik.localhost:9100/if/admin/"
    }
  ],
  "focusBullets": [
    "TFE must be running before hal tf saml enable (hal tf create first).",
    "Authentik is shared with hal vault oidc — only one stack, multiple consumers.",
    "Demo users: alice (group: admins) and bob (group: devs). TFE auto-creates matching teams.",
    "With --scim, TFE team membership is managed automatically from Authentik groups.",
    "Use --target twin to wire SAML/SCIM for the twin TFE instance independently."
  ],
  "notes": [
    "hal tf saml enable bootstraps the TFE admin token automatically — no manual token export needed.",
    "IdP metadata (SSO URL + cert) is fetched from Authentik and applied to TFE in a single flow.",
    "SCIM token is org-scoped in TFE (POST /api/v2/organizations/hal-org/scim-tokens).",
    "Authentik SCIM provider uses verify_ssl: false because TFE uses a self-signed cert.",
    "hal tf saml update --scim --sync re-pushes all group membership without full re-provision."
  ],
  "samplePrompts": [
    "How do I enable SAML SSO for TFE in HAL?",
    "How do I set up SCIM team provisioning for TFE?",
    "How do I enable SSO for the twin TFE instance?"
  ]
}
-->

# TFE SAML SSO and SCIM in HAL

Use this pack when the user is asking about TFE SAML SSO, TFE single sign-on, SCIM team provisioning, or Authentik integration with TFE.

## Ground Truth

- `hal tf saml enable` deploys Authentik IdP and wires TFE SAML via the Admin API.
- TFE must be running before enabling SAML — run `hal tf create` first.
- `hal tf saml enable --scim` additionally creates a TFE SCIM token and configures Authentik outbound sync for team membership.
- Authentik runs on port 9100 and is shared with `hal vault oidc` — only one Authentik stack runs for both.
- Demo users: `alice / password` (group: admins) and `bob / password` (group: devs).

## Workflow

- Enable SAML: `hal tf saml enable`
- Enable SAML + SCIM: `hal tf saml enable --scim`
- Re-provision: `hal tf saml update`
- Force SCIM re-sync: `hal tf saml update --scim --sync`
- Disable: `hal tf saml disable`
- Twin instance: add `--target twin`

## Under the hood

Authentik SAML provider → `tfe-saml-provider` with ACS URL `https://tfe.localhost:8443/users/saml/auth`. TFE SAML configured via `PATCH /api/v2/admin/saml-settings` with SSO URL and X509 cert parsed from Authentik metadata XML. SAML attribute names: `Username` → `attr_username`, `MemberOf` → `attr_groups`. SCIM endpoint (container-to-container): `https://hal-tfe-proxy:8443/api/scim/v2` with `verify_ssl: false`.

## MCP Rule

- Runtime SAML and TFE status should come from HAL MCP first.
- This file keeps the workflow framing and stable integration knowledge.
