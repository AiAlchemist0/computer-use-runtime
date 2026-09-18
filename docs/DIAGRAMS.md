# Architecture diagrams

Wired views of the capability runtime. Each diagram is a connection map: boxes are components, labeled edges are the actual contracts that travel between them.

Source of truth for these drawings: this file. The briefing at [deanshev.com/interface](https://deanshev.com/interface#wiring) renders the same maps. Narrative lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Table of contents

1. [System wiring](#1-system-wiring)
2. [Engine backplane](#2-engine-backplane)
3. [Discover compile path](#3-discover-compile-path)
4. [Replay interpreter](#4-replay-interpreter)
5. [HITL same-session](#5-hitl-same-session)
6. [Hosted vs local honesty](#6-hosted-vs-local-honesty)
7. [Capability contract and hands](#7-capability-contract-and-hands)
8. [Outcome taxonomy](#8-outcome-taxonomy)

---

## 1. System wiring

Three personas share one invoke contract. The bank never leaves loopback. The public briefing is a client of the Worker, not a second product.

```mermaid
flowchart TB
  subgraph personas["Personas"]
    Teller["Bank user / teller"]
    Analyst["Analyst / finance"]
    Agent["Agent / integrator"]
  end

  subgraph local["Local grade path — 127.0.0.1"]
    Serve["cli serve :8787"]
    Console["Dual-pane desk"]
    Bank["MockCore bank :8788"]
    Engine["@cur/engine"]
    Chromium["Playwright Chromium"]
  end

  subgraph hosted["Hosted extra — HTTPS"]
    Brief["deanshev.com/interface"]
    Worker["interface.deanshev.com"]
    Rec["recordedReplay + case book"]
  end

  Cap["Capability JSON\nlookup-savings-balance"]
  Result["RunResult\nsuccess | business_outcome | escalated | failed"]

  Teller -->|"Look up / type Member ID"| Console
  Analyst -->|"Replay / Discover / HITL"| Console
  Agent -->|"POST /capabilities/:id/invoke"| Serve
  Console --> Serve
  Serve -->|"replay / discover / session.*"| Engine
  Engine -->|"observe / act / extract"| Chromium
  Chromium -->|"HTTP loopback only"| Bank
  Engine -->|"compile / read"| Cap
  Engine --> Result

  Teller -->|"Look up"| Brief
  Analyst -->|"Replay lookup"| Brief
  Brief -->|"CORS + POST /api/replay"| Worker
  Worker --> Rec
  Rec --> Result
  Cap -.->|"same contract, no Chromium"| Rec
```

**Wires that matter**

| From | Trace | To | What travels |
| --- | --- | --- | --- |
| Desk / briefing | `POST /api/replay` | Engine or Worker | `{ memberId }` |
| Engine | `SurfaceAdapter.act` | Chromium | action + locator chain |
| Chromium | HTTP | MockCore | form POST `/lookup` |
| Discover | compile | Capability JSON | steps, `paramRef`, detectors, policy snapshot |
| Replay / recorded | return | Caller | `RunResult` + optional `hands[]` |

---

## 2. Engine backplane

Every production act goes through policy and session ownership before it touches the page. The LLM is a discover-only plug.

```mermaid
flowchart LR
  subgraph callers["Callers"]
    CLI["cli discover / replay"]
    API["serve /api/*"]
    Tests["vitest"]
  end

  subgraph engine["packages/engine"]
    Disc["discover()"]
    Rep["replay()"]
    LLM["DiscoverLlm\nfake | live SDK"]
    Pol["PolicyGuard"]
    Ses["Session\ncontrolOwner"]
    Adp["WebAdapter"]
    Prof["AppProfile\nmock-core-v1"]
    Store["FileStore"]
    Red["redactText"]
    Par["normalizeParamRef"]
  end

  CLI --> Disc
  CLI --> Rep
  API --> Disc
  API --> Rep
  Tests --> Disc
  Tests --> Rep

  Disc -->|"next(goal, aria, history, params)"| LLM
  Disc --> Red
  Disc --> Par
  Disc --> Pol
  Disc --> Ses
  Disc --> Adp
  Disc --> Prof
  Disc --> Store

  Rep --> Pol
  Rep --> Ses
  Rep --> Adp
  Rep --> Prof
  Rep --> Store

  Pol -->|"assertHost / assertRoute / assertAction"| Adp
  Ses -->|"assertAgent()"| Adp
  Adp -->|"page.route abort"| Pol
```

**Wires that matter**

| Trace | Enforced by | Fail closed as |
| --- | --- | --- |
| host + route + action | `PolicyGuard` | `POLICY_DENIED` |
| `/` is exact, not a prefix | `routeMatches` | `POLICY_DENIED` |
| agent act while human owns | `Session.assertAgent` | throw; HITL continues |
| unknown `paramRef` | `normalizeParamRef` | `UNKNOWN_PARAM_REF` |
| PII in the prompt | `redactText` before `llm.next` | value replaced |

---

## 3. Discover compile path

The model only picks a tool. The engine records what actually resolved. Status is `draft` unless `finish` and an `extract` both happened.

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator / CLI
  participant D as discover()
  participant P as PolicyGuard
  participant A as WebAdapter
  participant R as redactText
  participant L as DiscoverLlm
  participant C as Capability JSON

  Op->>D: goal + target + params + values
  D->>P: assertNavigate(target)
  D->>A: launch(target)
  loop maxSteps / deadline
    D->>A: observe() aria snapshot
    D->>D: hash aria — 3 identical = escalate
    D->>R: redact PII / SSN / account
    R->>L: next(goal, observation, history, declared params)
    L-->>D: one tool call
    alt finish
      D->>D: complete = finish AND extract exists
    else escalate
      D->>D: controlOwner = human
    else type / click / extract
      D->>D: coerceParamRef (reject unknown)
      D->>A: deriveChainFromRef or role+name
      D->>A: act(action, chain, value)
      D->>D: record waitFor from URL delta
    end
  end
  D->>C: write steps, detectors, policy snapshot<br/>approved or draft
```

```mermaid
flowchart LR
  Snap["aria YAML\n[ref=eN]"] --> Resolve["deriveChainFromRef"]
  Resolve --> Chain["LocatorChain\nrole_name + fingerprint"]
  Chain --> Artifact["Capability.steps[]"]
  Raw["memberId value"] -.->|"never written"| Artifact
  Ref["paramRef: memberId"] --> Artifact
```

---

## 4. Replay interpreter

No model. The artifact is the program. Detectors fire after the lookup click so a freeze is not `TARGET_NOT_FOUND`.

```mermaid
flowchart TB
  In["replay({ capability, values, target })"] --> Gate{"irreversible AND\nnot approved+confirm?"}
  Gate -->|yes| Esc["status escalated\nIRREVERSIBLE_GATED\ncontrolOwner=human"]
  Gate -->|no| Launch{"skipLaunch AND page open?"}
  Launch -->|no| Go["adapter.launch + assertNavigate"]
  Launch -->|yes| Entry
  Go --> Entry{"entry checkpoint\nMember lookup"}
  Entry -->|miss| FailCP["failed CHECKPOINT_FAILED"]
  Entry -->|ok| Loop

  subgraph Loop["for step i in resumeFrom..n"]
    A1["policy.assertAction"]
    A2["dismiss each interstitial once"]
    A3["timeout / sessionExpired → failed"]
    A4["fingerprint count drift → warning"]
    A5["paramRef → values[name]"]
    A6["extract or act"]
    A7["human-satisfied click → recovered"]
    A8["waitFor / slow-load recovered"]
    A9["detectors afterStep=i → business_outcome"]
    A10{"pauseAfterStep = i?"}
    A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8 --> A9 --> A10
  end

  Loop --> A10
  A10 -->|yes| Pause["escalated — human owns page"]
  A10 -->|no| Next["next step"]
  Next --> Loop
  A9 --> OutBiz["business_outcome + OutcomeCode"]
  Loop --> Success{"success checkpoint\nSavings balance"}
  Success -->|yes| Ok["success + outputs"]
  Success -->|no| FailCP2["failed CHECKPOINT_FAILED"]
```

---

## 5. HITL same-session

A new browser would drop the typed field, the chaos cookie, and the teller’s place. Pause and resume keep the Playwright page.

```mermaid
sequenceDiagram
  autonumber
  participant Desk as Analyst desk
  participant S as serve session Map
  participant R as replay()
  participant Ses as Session
  participant A as WebAdapter
  participant B as MockCore
  participant H as Bank user / teller

  Desk->>S: POST /api/session/start
  S->>A: launch(bankUrl)
  A->>B: GET /
  S-->>Desk: sessionId, controlOwner=agent

  Desk->>S: POST /api/session/:id/run { memberId }
  S->>R: skipLaunch, pauseAfterStep=0
  R->>A: type textbox Member ID via paramRef
  R->>Ses: setOwner(human)
  R-->>Desk: escalated — typed, not submitted

  Desk->>S: GET /api/session/:id/frame
  S->>A: screenshot JPEG
  S-->>Desk: live frame

  H->>Desk: click Look up on JPEG
  Desk->>S: POST /api/session/:id/click { nx, ny, viewport }
  S->>Ses: assert human + recordHuman
  S->>A: injectHumanInput + elementAtPoint
  A->>B: POST /lookup

  Desk->>S: POST /api/session/:id/resume
  S->>Ses: setOwner(agent)
  S->>R: skipLaunch, resumeFrom 1 or 2
  R->>A: extract status Savings balance
  R-->>Desk: success or business_outcome
```

---

## 6. Hosted vs local honesty

HTTPS cannot drive loopback Chromium. The Worker prints the same contract from the case book. That is a cut, not a disguise.

```mermaid
flowchart TB
  subgraph localLive["mode: local-live"]
    L1["pnpm serve"] --> L2["WebAdapter + Chromium"]
    L2 --> L3["MockCore 127.0.0.1"]
    L3 --> L4["real HTML / a11y tree"]
    L4 --> L5["HITL same session"]
  end

  subgraph recorded["mode: recorded-fallback"]
    H1["deanshev.com/interface"] -->|"GET /api/integration"| H2["Worker"]
    H1 -->|"POST /api/replay"| H3["gatedReplay"]
    H3 --> H4{"DEMO_ENABLED?"}
    H4 -->|false| H5["503 kill-switch-recorded"]
    H4 -->|true| H6{"Turnstile if secret set"}
    H6 -->|fail| H7["403"]
    H6 -->|ok| H8["recordedReplay(memberId)"]
    H8 --> H9["RunResult + hands\nextract blocked unless success"]
  end

  Note1["DO lock is for a future live Container.\nRecorded JSON is not exclusive-locked."]
  H3 -.-> Note1
```

---

## 7. Capability contract and hands

The integration layer is three typed steps plus a policy snapshot. Front-ends visualize `hands[]`; they do not invent locators.

```mermaid
flowchart LR
  subgraph cap["Capability lookup-savings-balance"]
    P["parameters.memberId\nsensitivity: pii"]
    S1["s1 type\ntextbox Member ID\nparamRef memberId"]
    S2["s2 click\nbutton Look up"]
    S3["s3 extract\nstatus Savings balance\n→ savingsBalance"]
    Pol["policy snapshot\nhosts 127.0.0.1\nroutes / /lookup /member"]
    Det["detectors after s2\nNOT_FOUND FROZEN ESTATE\nPERMISSION VALIDATION"]
    P --> S1 --> S2 --> S3
    S2 --> Det
  end

  Invoke["POST { memberId: 12345 }"] --> S1
  S3 --> Out["outputs.savingsBalance = $1,842.17"]
  Det -->|"66778 / 77889 / 88888 / 99999 / 1010"| Biz["business_outcome\nhand s3 state=blocked"]
```

Stable accessible names — the only locators the bank may expose:

`Member lookup` · `Member ID` · `Look up` · `Savings balance` · `Open sub-account` · `Confirm open` · `Dismiss notice`

---

## 8. Outcome taxonomy

```mermaid
flowchart TB
  Run["Replay finished a step"] --> Q1{"Expected core message?"}
  Q1 -->|No such member / frozen / estate / permission / validation| Biz["business_outcome"]
  Q1 -->|no| Q2{"Human owns session?"}
  Q2 -->|pause / irreversible / model escalate| Esc["escalated"]
  Q2 -->|no| Q3{"Unique target + checkpoints?"}
  Q3 -->|0 matches| F1["failed TARGET_NOT_FOUND"]
  Q3 -->|2+ matches| F2["failed AMBIGUOUS_TARGET"]
  Q3 -->|wait died| F3["failed TIMEOUT"]
  Q3 -->|host/route/action| F4["failed POLICY_DENIED"]
  Q3 -->|entry/success miss| F5["failed CHECKPOINT_FAILED"]
  Q3 -->|Savings balance visible| Ok["success + outputs"]
```

`IRREVERSIBLE_GATED` is a failure/escalation code, not a credit-union message. `ACCOUNT_FROZEN` is the opposite: the locators worked and the core said no.
