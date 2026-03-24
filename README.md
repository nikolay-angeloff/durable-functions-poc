# Durable Functions demo (Azure)

React **form** + separate **monitor** SPA → HTTP Function → **Service Bus** (two queues) → **Durable orchestrations** → SendGrid email. Infra: **Bicep** (two Static Web Apps). CI: **GitHub Actions**. Edge: **API Management** (optional, `deployApim` in parameters).

## Prerequisites

- Azure subscription, [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/install#azure-cli) (`az bicep install`)
- Resource group (e.g. `az group create -n rg-durable-demo -l westeurope`)
- GitHub secrets (repository **Actions** secrets):

| Secret | Value |
|--------|--------|
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | Client secret **value** (not the secret ID) |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID |
| `AZURE_RESOURCE_GROUP` | Resource group name (e.g. `rg-durable-demo`) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token for the **form** Static Web App (Portal → SWA → *Manage deployment token*) |
| `AZURE_STATIC_WEB_APPS_MONITOR_API_TOKEN` | Deployment token for the **monitor** Static Web App (second SWA, name `*-monswa-*`) |
| `VITE_API_BASE_URL` | Optional in CI; base URL for API calls in both SPAs (see below) |

The workflow runs **`az login --service-principal`**. Both SWA tokens are **required** for deploy (otherwise `deployment_token was not provided`). **`VITE_API_BASE_URL`** for production builds:

- **API Management:** `https://<apim-name>.azure-api.net` (template exposes `/submit` at the gateway root).
- **Function App only (no APIM):** `https://<function-app>.azurewebsites.net/api` (must include `/api` so the client calls `.../api/submit`, `.../api/orchestration-monitor`, etc.).

## Local development

1. **Storage emulator:** [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) for `AzureWebJobsStorage`.
2. **Service Bus:** use a real namespace (queues `form-azure`, `form-m365`) — copy connection string into `functions/local.settings.json` (see `local.settings.json.example`).
3. Copy `functions/local.settings.json.example` → `functions/local.settings.json` and fill values.
4. Terminal A — Functions: `cd functions && npm install && npm run build && npm start` (requires [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)).
5. Terminal B — Form app: `cd frontend && npm install && npm run dev` (port **5173**; proxies `/api` to `http://127.0.0.1:7071`).
6. Optional — Monitor app: `cd frontend-monitor && npm install && npm run dev` (port **5174**; same `/api` proxy). Set `VITE_FORM_APP_BASE_URL=http://localhost:5173` if you want “Open form” links from the monitor to hit the form dev server.

## Deploy infra manually

```bash
az deployment group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --template-file infra/bicep/main.bicep \
  --parameters @infra/bicep/parameters/demo.parameters.json
```

Set `deployApim: true` in parameters for API Management (first activation can take 30+ minutes). Configure SendGrid on the Function App: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (verified sender).

### Correction pause — resume link email

When a mock step fails, the workflow waits for **`POST /correction`**. The activity **`publishCorrectionNotification`** also sends a **transactional email** to the submitter’s address (same SendGrid settings as completion mail) if **`WEB_APP_BASE_URL`** is set. The message includes a link:

`WEB_APP_BASE_URL/?correlationId=<inquiry-id>`

Opening that URL loads the SPA with the same **correlation / inquiry ID** and starts status polling so the user can submit a correction (“restart” the human step without a new form submission).

- **Bicep:** optional parameter **`webAppBaseUrl`** overrides the default `https://<Static Web App default hostname>` for `WEB_APP_BASE_URL` on the Function App (no trailing slash). Demo parameters set the dev Static Web App host **`https://victorious-ocean-036a1ed03.2.azurestaticapps.net`**.
- **Local:** copy `local.settings.json.example` — `WEB_APP_BASE_URL` points at that same dev SPA so resume links match the deployed frontend when testing locally. If `WEB_APP_BASE_URL` or SendGrid is missing, the resume email is skipped (see Function logs).

## Project layout

- `functions/` — Node.js 20, Durable Functions, HTTP `submit`, Service Bus starters, `sendEmail` activity
- `frontend/` — Vite + React **form** SPA
- `frontend-monitor/` — Vite + React **monitor** SPA (orchestration list; separate Static Web App in Azure)
- `infra/bicep/` — Service Bus, Function App, **two** Static Web Apps, Log Analytics / App Insights, optional APIM

See `PROJECT.md` for architecture and decisions. Mermaid diagrams per product path: [`docs/azure-orchestration.md`](docs/azure-orchestration.md), [`docs/m365-orchestration.md`](docs/m365-orchestration.md).

### Orchestration monitor (second Static Web App)

Bicep deploys a **second** Static Web App (`*-monswa-*`) for **`frontend-monitor`**. It calls **`GET /api/orchestration-monitor`** on the same Function App (`DurableClient.getStatusAll()`). CI sets **`VITE_FORM_APP_BASE_URL`** to the **form** SWA URL so **Open form** / resume links point at the primary site. Optional app setting **`MONITOR_DASHBOARD_KEY`**: when set, send header **`X-Monitor-Key`** (the monitor UI can paste it once; stored in `sessionStorage`). Not a full [Durable Functions Monitor](https://github.com/microsoft/DurableFunctionsMonitor) (Gantt, history).

If **`VITE_API_BASE_URL`** points only at **API Management** and the template exposes just `/submit`, add APIM routes for **`/orchestration-monitor`**, **`/orchestration-status`**, **`/correction`**, or call the Function App host for those paths.
