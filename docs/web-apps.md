# Уеб слой: две отделни Static Web Apps

В проекта има **два публични URL-а** (два **Azure Static Web Apps** ресурса), не един общ SPA с табове.

| Приложение | Папка в repo | Bicep име (шаблон) | Роля |
|------------|--------------|---------------------|------|
| **Форма** | `frontend/` | `*-swa-*` | Подаване на заявка, polling на `GET /api/orchestration-status`, корекции през `POST /api/correction`, resume от имейл (`?correlationId=`). |
| **Монитор** | `frontend-monitor/` | `*-monswa-*` | Таблица с оркестрации през `GET /api/orchestration-monitor`; линк **Open form** сочи към URL-а на **формата** (`VITE_FORM_APP_BASE_URL`). |

И двете SPAs викат **същия** HTTP API (Azure Function App), зададен с **`VITE_API_BASE_URL`** при build (напр. `https://<function-app>.azurewebsites.net/api` или APIM).

## URL-и след deploy

След `az deployment group create` (или GitHub Actions) Bicep връща:

- `staticWebAppHostname` — хост на **формата**
- `staticWebAppMonitorHostname` — хост на **монитора**

Формат: `https://<hostname>.azurestaticapps.net` (без trailing slash).

## GitHub Actions секрети

| Секрет | Към кой SWA се отнася |
|--------|------------------------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token от Portal → **формата** SWA → *Manage deployment token* |
| `AZURE_STATIC_WEB_APPS_MONITOR_API_TOKEN` | Deployment token от **втория** SWA (`*-monswa-*`) |

И двата са **задължителни** за успешен deploy на двете приложения.

## Променливи при build (CI)

| Променлива | Къде | Значение |
|------------|------|----------|
| `VITE_API_BASE_URL` | И двете SPAs | Базов URL към API (с `/api` ако сочи директно към Function App). |
| `VITE_FORM_APP_BASE_URL` | Само **монитор** | Публичен URL на **формата** (за линкове „Open form“). В workflow се задава автоматично като `https://<form SWA hostname>`. |

## Имейл за корекция (`WEB_APP_BASE_URL`)

На Function App се задава **`WEB_APP_BASE_URL`** — винаги трябва да сочи към **формата** (основният SWA), не към монитора, защото линкът в имейла отваря формата с `?correlationId=`.

По подразбиране Bicep ползва `https://<първи SWA defaultHostname>` или override през параметър `webAppBaseUrl` в `demo.parameters.json`.

## Локална разработка

| Терминал | Команда | Порт |
|----------|---------|------|
| Форма | `cd frontend && npm run dev` | **5173** |
| Монитор | `cd frontend-monitor && npm run dev` | **5174** |

И двете proxy-ват `/api` към Functions Core Tools (`7071`). За линкове „Open form“ от монитора към локална форма: `VITE_FORM_APP_BASE_URL=http://localhost:5173`.

## Опционална защита на монитора

Ако на Function App е зададено **`MONITOR_DASHBOARD_KEY`**, `GET /api/orchestration-monitor` изисква header **`X-Monitor-Key`** (или `?key=`). UI на монитора позволява да се въведе ключ (пази се в `sessionStorage`).

## APIM

Ако клиентът ползва само gateway и са отворени само част от пътищата, трябва да са достъпни и **`/orchestration-monitor`**, **`/orchestration-status`**, **`/correction`** (или директно към host на Function App за тези маршрути).
