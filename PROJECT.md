# Project: Azure Durable Functions demo — web form, Service Bus, IaC, GitHub Actions

## 1. Goal

A demonstration app on Azure that showcases **Durable Functions** (orchestrations), **decoupling** via **Azure Service Bus**, a **React** web tier, a public entry through an **API gateway**, and **infrastructure as code** with **automated build and deploy** from GitHub Actions.

---

## 2. “Lambda” and “CloudFront” equivalents in Azure

| Concept (AWS / generic) | Azure equivalent (for this project) |
|-------------------------|-------------------------------------|
| Lambda (serverless functions) | **Azure Functions** (Consumption or Flex Consumption plan) |
| API Gateway | **Azure API Management (APIM)** — single REST entry, policies, versioning |
| CloudFront (CDN in front of static content) | **Azure Front Door** + **Azure Storage (static website)** **or** **Azure Static Web Apps** (built-in CDN, simpler for SPAs) |

**PoC recommendation:** **Azure Static Web Apps** for React (CDN + HTTPS + custom domain are straightforward) **or** Storage static website + **Azure CDN / Front Door** if you want finer control at the network edge. APIM sits in front of **HTTP-triggered** Functions (or a single “facade” Function), not in front of the static host itself.

---

## 3. Functional requirements

### 3.1 Web tier — two Static Web Apps

The repo ships **two separate React SPAs**, each deployed to its **own** Azure Static Web App (different URLs):

| SPA | Purpose |
|-----|---------|
| **Form** (`frontend/`) | Submit workflow, poll orchestration status, submit corrections, resume via `?correlationId=` |
| **Monitor** (`frontend-monitor/`) | Read-only list of Durable instances (`GET /api/orchestration-monitor`); “Open form” links target the **form** SWA URL (`VITE_FORM_APP_BASE_URL` at build time) |

Both apps call the **same** Function App HTTP API (`VITE_API_BASE_URL`). See **[docs/web-apps.md](docs/web-apps.md)** for secrets, ports, and resume-email behaviour.

### 3.2 Form fields (React)

Four fields:

| Field | Type |
|-------|------|
| Name | text |
| Email | email |
| Phone | phone |
| Choice | radio: **Azure** \| **M365** |

### 3.3 Submit behavior (logical)

1. The frontend **does not** call Durable orchestrations directly. It sends data to the **backend API** (via APIM).
2. The backend (one **HTTP-triggered Function** or a minimal endpoint) **validates** input and publishes a **message to the correct Service Bus queue** (or subscription) for **Azure** vs **M365** — see §4 and §5.
3. A **separate** Function (trigger: **Service Bus**) starts a **Durable orchestration** (or two different orchestrations depending on “Azure” / “M365” — see §4).
4. The orchestration runs **multiple mock steps** with optional **human correction** (Service Bus notification + external event); see **§4.1**.
5. When the flow **completes**: send an **email** via **Azure Communication Services Email** for **both** radio options; the “Azure” / “M365” choice only affects which Durable path runs, not the mail provider.

The form is thereby **decoupled** from long-running work and from email: it only initiates asynchronous work through a queue.

---

## 4. Proposed architecture (logical flow)

Mermaid диаграми (end-to-end, Durable flowchart и sequence) са в отделни файлове:

- **[Azure — `azureOrchestration`](docs/azure-orchestration.md)** — паралелни `validate` ∥ `enrich`, join с агрегирани грешки, после `approve`.
- **[Microsoft 365 — `m365Orchestration`](docs/m365-orchestration.md)** — последователни стъпки `tenantReadiness` → `licenseCheck` → `consentGate`.

**Two flows:** Implementation options:

- **Option A:** One queue/topic; the message includes `product: Azure | M365`; a single orchestrator branches logic.
- **Option B:** Two separate queues or topic subscriptions — one trigger for “Azure” and one for “M365”, each starting its own orchestration.

For a demo, **Option B** is often clearer; **Option A** uses fewer resources.

**Chosen:** **Option B** — two separate queues (or two topic subscriptions) and two `ServiceBusTrigger` functions (one for “Azure”, one for “M365”).

### 4.1 Durable workflow — mock steps, Service Bus on failure, human correction

**Two separate orchestrations** (different files, activities, and step names):

| Flow | Orchestrator | Mock activity | Steps (order) |
|------|--------------|---------------|-----------------|
| **Azure** | `azureOrchestration` | `mockAzureValidate`, `mockAzureEnrich`, `mockAzureApprove` | **`validate` ∥ `enrich`** (parallel, join) → **`approve`** (sequential) |
| **Microsoft 365** | `m365Orchestration` | `mockM365TenantReadiness`, `mockM365LicenseCheck`, `mockM365ConsentGate` | `tenantReadiness` → `licenseCheck` → `consentGate` |

Correction handling (Service Bus `correction-needed`, `waitForExternalEvent`, Table Storage, HTTP poll/submit) is parallel in structure but **not** shared code — each orchestration is implemented independently in `azureOrchestration.ts` / `m365Orchestration.ts`.

On failure each flow publishes to **`correction-needed`** with **`flow: azure | m365`** in the message body and **custom status** includes `flow` for the UI. The **form** SPA **polls** `GET /api/orchestration-status` and submits corrections via **`POST /api/correction`** (`raiseEvent`). **Table Storage** maps `correlationId` → `instanceId`. For Azure parallel failures, **custom status** may include **`aggregatedFailures`**. The **monitor** SPA is optional tooling and uses **`GET /api/orchestration-monitor`** (admin-style listing); it does not replace the form for corrections.

---

## 5. Azure Service Bus — “events” and decoupling

- **Service Bus queues** — one message is processed by one consumer; good for a task queue.
- **Service Bus topics + subscriptions** — one publisher, many subscribers (“event-like” within Service Bus).

Both **Event Grid** and **Service Bus** are valid for async patterns; your requirement explicitly names **Service Bus**, so the Functions trigger is **`ServiceBusTrigger`**, not Event Grid.

---

## 6. Infrastructure as code (IaC)

**Recommendation for an all-Azure stack:** **Bicep** (or **Terraform** if your org standardizes on it).

Minimum resource set in templates:

| Resource | Role |
|----------|------|
| Resource group | container |
| Storage account | Functions + (if needed) static assets |
| Function App + plan | Durable + HTTP + Service Bus triggers |
| Service Bus namespace | **two queues** (or topic + two subscriptions) for Azure vs M365 |
| API Management | gateway |
| **Azure Static Web Apps (×2)** | **Form** SPA + **monitor** SPA — separate hostnames (`*-swa-*` and `*-monswa-*` in Bicep) |
| (optional) Key Vault | secrets (connection strings, ACS connection string) |
| Application Insights | observability |

Parameters: **single demo** environment, names, APIM SKU.

---

## 7. GitHub Actions — build and deploy

- **Triggers:** `push` to `main` / `release` tags (per your policy).
- **Steps (as implemented):**
  1. Checkout, setup Node.
  2. `az login` (service principal), **Bicep** deploy to resource group.
  3. Build & publish **Functions** (`func azure functionapp publish`).
  4. `npm ci` / `npm run build` for **`frontend/`** (form) and **`frontend-monitor/`** (monitor); production env: `VITE_API_BASE_URL`, and for the monitor build **`VITE_FORM_APP_BASE_URL`** = `https://<form SWA hostname>` from deployment outputs.
  5. **Two** Azure Static Web Apps deploy steps: **`AZURE_STATIC_WEB_APPS_API_TOKEN`** (form dist) and **`AZURE_STATIC_WEB_APPS_MONITOR_API_TOKEN`** (monitor dist).

**GitHub secrets (minimum):** `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, **`AZURE_STATIC_WEB_APPS_API_TOKEN`**, **`AZURE_STATIC_WEB_APPS_MONITOR_API_TOKEN`**, optional **`VITE_API_BASE_URL`**. See [docs/web-apps.md](docs/web-apps.md) and [README.md](README.md).

---

## 8. Risks and constraints (brief)

- **APIM cold start / cost** — for a PoC use a lower SKU or temporarily call the Function over HTTPS directly (dev only), then add APIM.
- **Durable + Service Bus** — idempotency on message retries (optional duplicate detection in Service Bus).
- **Email** — **Azure Communication Services Email**; connection string / sender in Key Vault / App settings.

---

## 9. Implementation phases

| Phase | Content |
|-------|---------|
| 1 | Repo: React form + one HTTP Function + Service Bus publish + Service Bus trigger + minimal Durable orchestration + one email at the end |
| 2 | Bicep for all resources + GitHub Actions |
| 3 | APIM in front of HTTP Function + policies |
| 4 | Richer orchestration steps, observability and security hardening |

---

## 10. Decisions (confirmed)

| Topic | Choice |
|-------|--------|
| **Functions runtime** | **Node.js / TypeScript** (Durable Functions) |
| **Email** | **Azure Communication Services Email** for **both** “Azure” and “M365” form options |
| **Static frontend** | **Azure Static Web Apps** — **two** apps (form + monitor); separate deployment tokens |
| **Service Bus shape** | **Two** queues or **two** topic subscriptions — separate triggers per product path |
| **Environments** | **Single demo** — one resource group (prod-like for the PoC) |

---

## 11. IaC layout (Bicep)

Implemented layout for **one** demo environment (consolidated template; can be split into modules later):

```
infra/
  bicep/
    main.bicep                 # Service Bus, Function App, two SWAs, Log Analytics, App Insights, optional APIM
    parameters/
      demo.bicepparam          # Bicep parameter file (using)
      demo.parameters.json     # JSON parameters (CLI / Actions)
docs/
  web-apps.md                  # Two SPAs, URLs, secrets, env vars
  azure-orchestration.md       # Azure Durable flow (Mermaid)
  m365-orchestration.md        # M365 Durable flow (Mermaid)
```

- **`main.bicep`** exposes **outputs**: function app name/host, **both** SWA hostnames (`staticWebAppHostname`, `staticWebAppMonitorHostname`), optional APIM URLs.
- **Secrets** are not committed: set ACS Email and other keys on the Function App after deploy, or use Key Vault + pipeline parameters.
- **CI:** `az deployment group create` with `main.bicep` + `parameters/demo.parameters.json`.

The same structure can map to **Terraform** (`infra/terraform/modules/...`, `environments/demo/terraform.tfvars`) if you standardize on Terraform instead of Bicep.

---

*This document is the baseline for scoping, implementation, and later extension of the demo.*
