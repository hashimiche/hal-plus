* this is the graphic interface of HAL, the Hashicorp Academy Labs cli (check the github repo : https://github.com/hashimiche/hal or the directory on this host ../hal)
* the purpose is educational for the user
* there is chat prompt for the user to ask questions to local or remote LLM, with MCPs : Hal mcp, Vault, TF, Vault Audit (https://github.com/czembower/vault-audit-mcp), Nomad, Consul.
* UX contract is defined in UX_PARITY.md (layout, host/routes, themes, compact header, status chips, parity behavior).
* Typescript and Vite were nice for my first iteration but if you have an efficient tech stack, write it here.
* use the hal_logo.png as ico for the tab and for the main page. As soon as the first text is entered, the ico and other information are reduced to give room to the chat.
* status chips should keep Hashi Lens semantics for HAL products (endpoint/state/version/features in hover details).
* visual direction should be inspired by VS Code light/dark themes (not flashy, readable, console-first).
* the structure of the answers should be hal oriented so check the status of hal component, give insight with hal commands, with related official doc, then based on this official docs, expand usage and give usable code block, not hallucinated (rely on MCPs).
* reference example for answer quality:
  * "I want to setup VSO with CSI" => "you can run 'hal vault deploy -e ent' to deploy vault enterprise as it's necessary for CSI (boom link to the doc), then 'hal vault k8s -e' to deploy a Kind cluster acting as Kubernetes, and the VSO helm chart (helm binary needed => link to VSO deployment doc). you will then have pods that will show a secret from this path in vault into a browsable website (url). You can try the auto rollout with regular VSO (non CSI). give the 'hal vault k8s -e -f' and explain the fact that a change of password force pods to restart and you can see live the website page being updated (link to documentation)"