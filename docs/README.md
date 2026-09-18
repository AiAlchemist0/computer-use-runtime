# Documentation

This folder is the architecture record for the capability runtime. Start here if you are reviewing the take-home.

## Table of contents

1. [Architecture](./ARCHITECTURE.md) — design thesis, system map, and every component
   1. [What this system is](./ARCHITECTURE.md#1-what-this-system-is)
   2. [Design thesis](./ARCHITECTURE.md#2-design-thesis)
   3. [System map](./ARCHITECTURE.md#3-system-map)
   4. [Repository layout](./ARCHITECTURE.md#4-repository-layout)
   5. [Schema and contracts](./ARCHITECTURE.md#5-schema-and-contracts)
   6. [SurfaceAdapter](./ARCHITECTURE.md#6-surfaceadapter)
   7. [PolicyGuard](./ARCHITECTURE.md#7-policyguard)
   8. [Discover](./ARCHITECTURE.md#8-discover)
   9. [Replay](./ARCHITECTURE.md#9-replay)
   10. [Session and HITL](./ARCHITECTURE.md#10-session-and-hitl)
   11. [AppProfile and outcome detectors](./ARCHITECTURE.md#11-appprofile-and-outcome-detectors)
   12. [Parameters and redaction](./ARCHITECTURE.md#12-parameters-and-redaction)
   13. [Store and evidence](./ARCHITECTURE.md#13-store-and-evidence)
   14. [Mock bank](./ARCHITECTURE.md#14-mock-bank)
   15. [Case book](./ARCHITECTURE.md#15-case-book)
   16. [Operator console](./ARCHITECTURE.md#16-operator-console)
   17. [CLI](./ARCHITECTURE.md#17-cli)
   18. [Hosted worker](./ARCHITECTURE.md#18-hosted-worker)
   19. [Briefing as an integration client](./ARCHITECTURE.md#19-briefing-as-an-integration-client)
   20. [Outcome taxonomy](./ARCHITECTURE.md#20-outcome-taxonomy)
   21. [Safety model](./ARCHITECTURE.md#21-safety-model)
   22. [Testing](./ARCHITECTURE.md#22-testing)
   23. [Trade-off catalog](./ARCHITECTURE.md#23-trade-off-catalog)
   24. [Explicit cuts](./ARCHITECTURE.md#24-explicit-cuts)
   25. [What we would change next](./ARCHITECTURE.md#25-what-we-would-change-next)
2. [Wired diagrams](./DIAGRAMS.md) — labeled connection maps
   1. [System wiring](./DIAGRAMS.md#1-system-wiring)
   2. [Engine backplane](./DIAGRAMS.md#2-engine-backplane)
   3. [Discover compile path](./DIAGRAMS.md#3-discover-compile-path)
   4. [Replay interpreter](./DIAGRAMS.md#4-replay-interpreter)
   5. [HITL same-session](./DIAGRAMS.md#5-hitl-same-session)
   6. [Hosted vs local honesty](./DIAGRAMS.md#6-hosted-vs-local-honesty)
   7. [Capability contract and hands](./DIAGRAMS.md#7-capability-contract-and-hands)
   8. [Outcome taxonomy](./DIAGRAMS.md#8-outcome-taxonomy)
3. [Evidence index](../evidence/INDEX.md) — compiled discovery, live draft, replay, HITL
4. [Hosted Container spike](../apps/worker/SPIKE.md) — why recorded-fallback is the live default
5. [Assignment report](../REPORT.md) — shorter narrative keyed to the prompt
6. [Repository README](../README.md) — clone, serve, replay
7. [Live briefing maps](https://deanshev.com/interface#wiring) — same wiring on deanshev.com

## How to read this

- **Grade the engine locally.** Clone this repo, run `pnpm test`, then `pnpm serve`. The hosted pages are a recorded extra.
- **Treat the capability JSON as the product.** Discover writes it. Replay executes it. The LLM is not in production.
- **Treat outcomes as first-class.** Frozen, estate, permission, and not-found are business results, not locator failures.
- **Treat hosted vs local as two honesty modes.** Local launches Chromium. Hosted prints the same contract from recorded cases.

## What is in scope for a reviewer

| Surface | Lives | What it proves |
| --- | --- | --- |
| `pnpm test` | This repo | Schema, policy, discover, replay, HITL, redaction |
| `pnpm serve` | `127.0.0.1` | Live bank + dual-pane desk + same-session handoff |
| [interface.deanshev.com](https://interface.deanshev.com) | Cloudflare Worker | Recorded-fallback of the same invoke contract |
| [deanshev.com/interface](https://deanshev.com/interface) | Pages | Front-end client of `POST /api/replay` plus wired diagrams |
