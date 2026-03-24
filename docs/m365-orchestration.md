# Microsoft 365 product path — `m365Orchestration`

Оркестрацията **`m365Orchestration`** изпълнява стъпките **последователно**: `tenantReadiness` → `licenseCheck` → `consentGate` (activity **`mockM365Step`**). При неуспех на стъпка се изпраща известие към опашката **`correction-needed`**, UI ползва **`GET /orchestration-status`** и **`POST /correction`** със същия `correlationId`.

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
    Durable[m365Orchestration]
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

## Детайл: Durable — последователни стъпки

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
    QF[(form-m365)]
    QC[(correction-needed)]
  end

  subgraph Durable["m365Orchestration"]
    Reg[registerCorrelation]
    Seq[Последователно: tenantReadiness → licenseCheck → consentGate]
    Pub[publishCorrectionNotification]
    W[waitForExternalEvent CorrectionSubmitted]
    Mail[sendEmail]
  end

  subgraph Store["Storage"]
    Tab[(Table: correlationId → instanceId)]
  end

  FA --> S
  S --> QF
  QF -->|ServiceBusTrigger startNew| Reg
  Reg --> Tab
  Reg --> Seq
  Seq -->|стъпка fail| Pub
  Pub --> QC
  Pub --> W
  Seq -->|всички стъпки ok| Mail
  Poll --> G
  G --> Tab
  FB --> C
  C -->|raiseEvent| W
  W -->|повторение на текущата стъпка| Seq
```

При fail на дадена стъпка оркестраторът изчаква корекция и **извиква отново същата** `mockM365Step` със същото `stepName`, след което при успех продължава към следващата стъпка в веригата.

## Sequence: последователни стъпки и корекция

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant SPA as React SPA
  participant Submit as POST /submit
  participant SB as Service Bus
  participant Trig as SB trigger + Durable client
  participant Orch as m365Orchestration
  participant Act as Activities
  participant T as Table Storage
  participant Status as GET /orchestration-status
  participant Fix as POST /correction

  User->>SPA: Попълване на форма A
  SPA->>Submit: JSON + correlationId
  Submit->>SB: enqueue form-m365
  Submit-->>SPA: 202 Accepted
  SB->>Trig: message
  Trig->>Orch: startNew
  Orch->>Act: registerCorrelation
  Act->>T: upsert correlationId → instanceId

  loop tenantReadiness → licenseCheck → consentGate
    Orch->>Act: mockM365Step (текуща стъпка)
    alt fail
      Act-->>Orch: ok false
      Orch->>Act: publishCorrectionNotification
      Act->>SB: enqueue correction-needed
      Note over Orch: setCustomStatus — failedStep + reason
      Orch->>Orch: waitForExternalEvent CorrectionSubmitted
      par Poll
        SPA->>Status: GET ?correlationId=
        Status->>T: getEntity
        Status-->>SPA: runtimeStatus + customStatus
      and Корекция
        User->>SPA: Форма B
        SPA->>Fix: correction payload
        Fix->>Orch: raiseEvent CorrectionSubmitted
      end
      Orch->>Act: mockM365Step retry същата стъпка
    else success
      Act-->>Orch: ok true
    end
  end

  Orch->>Act: sendEmail
```
