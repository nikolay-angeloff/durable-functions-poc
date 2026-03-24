# Azure product path — `azureOrchestration`

Оркестрацията **`azureOrchestration`** използва **паралелни** стъпки **validate** и **enrich** (`context.df.Task.all`), **join** с обединени грешки и **една** корекция към уеб приложението при неуспех. След успешен join следва **последователна** стъпка **approve** (собствен цикъл за корекция при нужда).

## Кога фейлват стъпките (mock — отделни activities)

Всяка стъпка е **отделна** Azure Function activity: `mockAzureValidate`, `mockAzureEnrich`, `mockAzureApprove` (файлове в `functions/src/activities/`). Проверките са **демонстрационни**; съобщенията за грешка са фиксирани низове в кода.

| Стъпка | Условие за fail | Примерно съобщение към клиента |
|--------|-----------------|--------------------------------|
| **validate** | `name` след `trim` е по-къс от **2 символа** | `[Azure] Name too short (mock ARM validation)` |
| **enrich** | В `name` (без значение от главни/малки букви) се съдържа поднизът **`BLOCK`** | `[Azure] Enrichment blocked — policy on display name (mock)` |
| **approve** | `correctionConfirmed` е **false** или липсва (първоначалното submit го праща като `false`) | `[Azure] Risk gate: human confirmation required before provisioning (mock)` |

**Бележки:** Ако в паралелната фаза **и двете** стъпки fail-нат, UI получава **две** грешки наведнъж (`aggregatedFailures`). За да мине **approve**, потребителят трябва да изпрати корекция с **`correctionConfirmed: true`** (в SPA това е формата за корекция).

## End-to-end (логически)

```mermaid
flowchart LR
  subgraph Edge["Клиент / edge"]
    U[Браузър]
    CDN[Static host / SWA]
  end

  subgraph APIM["API"]
    GW[API Management]
  end

  subgraph Backend["Azure Functions"]
    HTTPFn[HTTP — submit]
    SBFn[Service Bus trigger]
    Durable[azureOrchestration]
  end

  subgraph Messaging["Messaging"]
    SB[(Service Bus)]
  end

  subgraph Mail["Изход"]
    EM[Email — SendGrid]
  end

  U --> CDN
  CDN --> GW
  GW --> HTTPFn
  HTTPFn --> SB
  SB --> SBFn
  SBFn --> Durable
  Durable --> EM
```

## Детайл: Durable — паралел validate ∥ enrich, join, approve

Две фази с различни корекционни цикли (събитието е едно и също: `CorrectionSubmitted`).

```mermaid
flowchart TD
  subgraph Web["Браузър / React"]
    FA[Форма A — correlationId]
    Poll[Poll GET /orchestration-status]
    FB[Форма B — корекция]
  end

  subgraph HTTP["HTTP Functions"]
    S[POST /submit]
    G[GET /orchestration-status]
    C[POST /correction]
  end

  subgraph SB["Service Bus"]
    QF[(form-azure)]
    QC[(correction-needed)]
  end

  subgraph P1["Фаза 1 — паралел validate ∥ enrich"]
    Reg[registerCorrelation]
    V[mockAzureValidate]
    En[mockAzureEnrich]
    J[Join]
    Pub1[publishCorrectionNotification]
    W1[waitForExternalEvent]
  end

  subgraph P2["Фаза 2 — approve"]
    Ap[mockAzureApprove]
    Pub2[publishCorrectionNotification]
    W2[waitForExternalEvent]
    Mail[sendEmail]
  end

  subgraph Store["Storage"]
    T[(Table: correlationId → instanceId)]
  end

  FA --> S --> QF --> Reg
  Reg --> T
  Reg --> V
  Reg --> En
  V --> J
  En --> J
  J -->|и двата ok| Ap
  J -->|някой fail| Pub1 --> QC --> W1
  W1 --> V
  W1 --> En
  Ap -->|ok| Mail
  Ap -->|fail| Pub2 --> QC --> W2 --> Ap
  Poll --> G --> T
  FB --> C
  C -->|raiseEvent| W1
  C -->|raiseEvent| W2
```

При паралелен fail **`aggregatedFailures`** в custom status и в Service Bus. При fail на approve — единичен **`failedStep: approve`** и **`phase: singleStep`**.

## Sequence: паралелна фаза и корекция

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant SPA as React SPA
  participant Submit as POST /submit
  participant SB as Service Bus
  participant Trig as SB trigger + Durable client
  participant Orch as azureOrchestration
  participant Act as Activities
  participant T as Table Storage
  participant Status as GET /orchestration-status
  participant Fix as POST /correction

  User->>SPA: Попълване на форма A
  SPA->>Submit: JSON + correlationId
  Submit->>SB: enqueue form-azure
  Submit-->>SPA: 202 Accepted
  SB->>Trig: message
  Trig->>Orch: startNew
  Orch->>Act: registerCorrelation
  Act->>T: upsert correlationId → instanceId

  loop Докато validate И enrich не са и двата ok
    par Паралелно
      Orch->>Act: mockAzureValidate
      And
      Orch->>Act: mockAzureEnrich
    end
    Act-->>Orch: MockApiResult x2
    alt поне един fail
      Orch->>Act: publishCorrectionNotification (aggregatedFailures)
      Act->>SB: enqueue correction-needed
      Note over Orch: setCustomStatus — всички грешки
      Orch->>Orch: waitForExternalEvent CorrectionSubmitted
      par Poll
        SPA->>Status: GET ?correlationId=
        Status->>T: lookup
        Status-->>SPA: customStatus + aggregatedFailures
      and Корекция
        User->>SPA: Форма B
        SPA->>Fix: correction payload
        Fix->>Orch: raiseEvent
      end
    else и двата ok
      Note over Orch: изход от паралелния цикъл
    end
  end

  loop Докато approve не е ok
    Orch->>Act: mockAzureApprove
    alt fail
      Orch->>Act: publishCorrectionNotification (single step)
      Act->>SB: enqueue correction-needed
      Orch->>Orch: waitForExternalEvent
      SPA->>Fix: корекция
      Fix->>Orch: raiseEvent
    else ok
      Note over Orch: напред
    end
  end

  Orch->>Act: sendEmail
```

## Уеб тир (форма vs монитор)

Корекциите и polling-ът към **`/orchestration-status`** са в **формата** SPA. Отделно **второ** Static Web App хоства само таблицата с инстанции (`/api/orchestration-monitor`) — различен публичен URL. Подробности: **[web-apps.md](web-apps.md)**.
