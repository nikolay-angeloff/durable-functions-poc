# Durable Functions demo (Azure)

React **form** + separate **monitor** SPA → HTTP Function → **Service Bus** (two queues) → **Durable orchestrations** → **Azure Communication Services Email**. Infra: **Bicep** (two Static Web Apps). CI: **GitHub Actions**. Edge: **API Management** (optional, `deployApim` in parameters).

## Prerequisites

- Azure subscription, [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/install#azure-cli) (`az bicep install`)
- Resource provider **`Microsoft.Communication`** registered (`az provider register -n Microsoft.Communication --wait`) if the subscription never used Communication Services before.
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
| `ACS_CONNECTION_STRING` | **Optional:** overrides Function App mail settings from Bicep (rotation / custom ACS). If unset, IaC values stay. |
| `ACS_EMAIL_SENDER` | **Optional:** overrides sender; use with `ACS_CONNECTION_STRING`. |

The workflow runs **`az login --service-principal`**. Both SWA tokens are **required** for deploy (otherwise `deployment_token was not provided`). **`VITE_API_BASE_URL`** for production builds:

- **API Management:** `https://<apim-name>.azure-api.net` (template exposes `/submit` at the gateway root).
- **Function App only (no APIM):** `https://<function-app>.azurewebsites.net/api` (must include `/api` so the client calls `.../api/submit`, `.../api/orchestration-monitor`, etc.).

### Email (IaC + optional pipeline override)

**Bicep** creates **Azure Communication Services** end-to-end: **Email Communication Service**, **Azure Managed Domain**, **DoNotReply** sender username, **Communication Services** (linked domain), and sets **`AZURE_COMMUNICATION_CONNECTION_STRING`** and **`ACS_EMAIL_SENDER`** on the Function App from the deployed resources (see `infra/bicep/main.bicep`). Parameter **`acsDataLocation`** (default `Europe`) controls data residency.

**GitHub secrets** `ACS_CONNECTION_STRING` and `ACS_EMAIL_SENDER` are **optional**. If **both** are set, the workflow step **Configure Function App — ACS Email** overwrites the Function App settings (useful for key rotation or pointing at another ACS resource). If either is missing, the step is skipped and **Bicep values remain**.

To override manually: GitHub → **Settings** → **Secrets and variables** → **Actions** → add both secrets → push or **Run workflow**. The service principal needs permission to update app settings (**Contributor** on the resource group is enough).

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

Set `deployApim: true` in parameters for API Management (first activation can take 30+ minutes). **Email** is provisioned by Bicep (ACS Email + Communication Services); override **`acsDataLocation`** in parameters if needed. See [Send email with ACS](https://learn.microsoft.com/azure/communication-services/quickstarts/email/send-email).

### Correction pause — resume link email

When a mock step fails, the workflow waits for **`POST /correction`**. The activity **`publishCorrectionNotification`** also sends a **transactional email** via ACS Email to the submitter’s address (same `AZURE_COMMUNICATION_CONNECTION_STRING` / `ACS_EMAIL_SENDER` as completion mail) if **`WEB_APP_BASE_URL`** is set. The message includes a link:

`WEB_APP_BASE_URL/?correlationId=<inquiry-id>`

Opening that URL loads the SPA with the same **correlation / inquiry ID** and starts status polling so the user can submit a correction (“restart” the human step without a new form submission).

- **Bicep:** optional parameter **`webAppBaseUrl`** overrides the default `https://<Static Web App default hostname>` for `WEB_APP_BASE_URL` on the Function App (no trailing slash). Demo parameters set the dev Static Web App host **`https://victorious-ocean-036a1ed03.2.azurestaticapps.net`**.
- **Local:** copy `local.settings.json.example` — `WEB_APP_BASE_URL` points at that same dev SPA so resume links match the deployed frontend when testing locally. If `WEB_APP_BASE_URL` or ACS Email env vars are missing, the resume email is skipped (see Function logs).

## Project layout

- `functions/` — Node.js 20, Durable Functions, HTTP `submit`, Service Bus starters, `sendEmail` activity
- `frontend/` — Vite + React **form** SPA
- `frontend-monitor/` — Vite + React **monitor** SPA (orchestration list; separate Static Web App in Azure)
- `infra/bicep/` — Service Bus, Function App, **two** Static Web Apps, Log Analytics / App Insights, optional APIM

### Documentation

| Doc | Content |
|-----|---------|
| [`PROJECT.md`](PROJECT.md) | Goals, architecture, IaC layout, decisions |
| [`docs/web-apps.md`](docs/web-apps.md) | **Two Static Web Apps** — URLs, GitHub secrets, `VITE_*`, resume email, local ports |
| [`docs/azure-orchestration.md`](docs/azure-orchestration.md) | Azure Durable flow (Mermaid) |
| [`docs/m365-orchestration.md`](docs/m365-orchestration.md) | Microsoft 365 Durable flow (Mermaid) |

### Orchestration monitor (second Static Web App)

Summary: separate hostname from the form app; build output from **`frontend-monitor/`**; **`GET /api/orchestration-monitor`** (list) and **`GET /api/orchestration-monitor-detail?instanceId=`** (history + parsed flow for charts); optional **`MONITOR_DASHBOARD_KEY`**; not the full [Durable Functions Monitor](https://github.com/microsoft/DurableFunctionsMonitor). **Details:** [`docs/web-apps.md`](docs/web-apps.md). APIM: expose **`/orchestration-monitor`**, **`/orchestration-monitor-detail`**, **`/orchestration-status`**, **`/correction`** (or call the Function App host directly).
