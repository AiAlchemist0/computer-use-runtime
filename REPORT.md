# REPORT

Design write-up for interface.ai Assignment A. Each section ends with **Detail** links into the long-form docs, the code that implements the claim, and the evidence that shows it ran.

Long-form: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [docs/DIAGRAMS.md](./docs/DIAGRAMS.md) · [evidence/INDEX.md](./evidence/INDEX.md) · [schemas/](./schemas) · [README.md](./README.md) (setup, demo path).

## 1. Architecture

Thesis: **record once, replay many, model never in production.** One Node/TypeScript engine (`packages/engine`) runs unchanged in the CLI, tests, and the local operator console, on four seams:

- **`SurfaceAdapter`** — `observe / resolve / act / extract / screenshot`. Playwright over the accessibility tree today; the capability never names CSS or a browser.
- **`PolicyGuard`** — host, route, and action-type allowlists plus an irreversible gate, in front of every act and navigation.
- **`Session`** — the control-transfer model: `controlOwner` is `agent` or `human`; agent acts throw while a human owns the page; timers return control.
- **`Store`** — capabilities and runs. Locally, files under `/evidence`, which is the graded catalog.

Discover lets an LLM pick one tool per turn (`type`, `click`, `extract`, `finish`, `escalate`); the engine records what actually resolved, then a **compile pass** turns the transcript into the contract. Replay interprets that contract and never calls a model. The target (`apps/bank`) is a deliberately hostile mock core — tables, an iframe, server-rendered posts, no test IDs — with an `x-chaos` header that injects every runtime condition the brief lists.

Trade-offs: we **own the adapter** rather than use Stagehand/Browserbase-style caches (same thesis; ours adds typed I/O, business-outcome detectors, a policy snapshot on the artifact, and a same-session HITL seam — cost: our own locator resolution). We **own the target** so every exceptional state is reproducible (cost: one surface). **Single process, files, no queue**; `Store` and `SurfaceAdapter` are the scale seams. The **hosted demo is recorded-fallback**: the Worker runs the engine's Chromium-free logic and serves the evidence pack, never a live browser.

**Detail:** ARCHITECTURE [§1](./docs/ARCHITECTURE.md#1-what-this-system-is), [§2](./docs/ARCHITECTURE.md#2-design-thesis), [§3 System map](./docs/ARCHITECTURE.md#3-system-map), [§6 SurfaceAdapter](./docs/ARCHITECTURE.md#6-surfaceadapter), [§18 Hosted worker](./docs/ARCHITECTURE.md#18-hosted-worker), [§23 Trade-off catalog](./docs/ARCHITECTURE.md#23-trade-off-catalog) · DIAGRAMS [§1 System wiring](./docs/DIAGRAMS.md#1-system-wiring), [§2 Engine backplane](./docs/DIAGRAMS.md#2-engine-backplane) · code `packages/engine/src/interfaces.ts`, `web-adapter.ts`, `discover.ts`, `replay.ts` · [apps/worker/SPIKE.md](./apps/worker/SPIKE.md).

## 2. Artifact schema

A capability is a **callable contract**: identity and `revision`, `status: draft | approved`, an `appProfile` ref, `provenance` (model, run id, created-at, source hash), `riskClass`, a **policy snapshot**, typed `parameters` (with `sensitivity: none | pii | secret`), typed `outputs`, `entry` and `success` checkpoints, ordered `steps`, `outcomeDetectors`, and `knownOutcomes`. Each step has an action, a **locator chain** (`role_name` → `label` → `text` → `nth_role` → `css`), a **fingerprint** (role, name, expected `candidateCount`, `framePath`), `input` as `paramRef` or literal, `outputName`, a recorded `waitFor`, its own `riskClass`, and the model's `why`.

Why this shape:

- **`paramRef`, never values** — the artifact is safe to commit and replays for any member.
- **Fingerprint + candidate count** — replay asserts one match; a different count is a drift warning, 2+ matches fail closed. Nothing clicks "the first one".
- **`framePath`** — the savings status lives in an iframe; the schema stays surface-agnostic.
- **Detectors after the lookup click** — "No such member" is a legitimate result, not a locator miss at extract.
- **Policy snapshot on the artifact** — a capability cannot widen its own allowlist.
- **Compile pass** — the model may repeat itself; the artifact does not. `outputName` folds onto declared outputs (`savings_balance → savingsBalance`), repeated extracts collapse, `outputs`/`success` derive from the extract tools, and Zod rejects any `outputName` not in `outputs[]`. Detectors and known outcomes stay profile-owned.

Three layers keep multi-tenant from becoming a blob of overrides: `AppProfile` (vendor recoveries, error patterns), `Capability` (the flow), `TenantBinding` (per-institution overrides; schema only in v1). JSON Schema for all four contracts is generated from Zod 4 into `/schemas`; a test fails if they drift.

**Detail:** ARCHITECTURE [§5 Schema and contracts](./docs/ARCHITECTURE.md#5-schema-and-contracts), [§8 Discover](./docs/ARCHITECTURE.md#8-discover), [§11 AppProfile](./docs/ARCHITECTURE.md#11-appprofile-and-outcome-detectors), [§12 Parameters and redaction](./docs/ARCHITECTURE.md#12-parameters-and-redaction) · DIAGRAMS [§3 Discover compile path](./docs/DIAGRAMS.md#3-discover-compile-path), [§7 Capability contract](./docs/DIAGRAMS.md#7-capability-contract-and-hands) · schema `packages/schema/src/capability.ts`, `types.ts`; compiler `packages/engine/src/compile.ts` · [schemas/capability.v1.json](./schemas/capability.v1.json) · example [evidence/capabilities/lookup-savings-balance.json](./evidence/capabilities/lookup-savings-balance.json).

## 3. Determinism & error handling

**Determinism.** Each locator chain is resolved in order and must match exactly one element. Waits are recorded from what actually changed in discovery (`url`, `text`, `element`, `load`), so replay waits for state, not time. Entry and success checkpoints are asserted; a click is never assumed to have worked. No model, no re-planning.

**Result contract.** `RunResult.status` is exactly one of four values:

| Status | Meaning | Detected by |
| --- | --- | --- |
| `success` | Success checkpoint met, declared outputs filled | checkpoint + extract |
| `business_outcome` | Legitimate answer the caller must handle: `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`, `ACCOUNT_FROZEN`, `ESTATE_HOLD`, `VALIDATION_FAILED` | `outcomeDetectors` after the lookup step |
| `escalated` | A human owns the session; carries an `InterventionRequest` | pause, irreversible gate, model escalate |
| `failed` | `stepIndex`, `expected`, `observed`, `code` (`TIMEOUT`, `UNEXPECTED_STATE`, `TARGET_NOT_FOUND`, `AMBIGUOUS_TARGET`, `CHECKPOINT_FAILED`, `POLICY_DENIED`, `IRREVERSIBLE_GATED`), `evidenceRefs` | profile error patterns, wait timeouts, locator resolution, policy |

**Recoverable conditions** emit `recovered` and continue: `AppProfile` interstitials are dismissed once per session, slow loads are waited out and flagged, and a click the human already performed during handoff counts as satisfied. Session expiry and a non-responding core are hard failures with the observed text captured. Chaos is session-scoped on the mock core so a fault survives the form post.

**Evidence on failure** is engine-owned: `replay()` captures a masked screenshot on `failed`/`escalated` into `failure.evidenceRefs`; the CLI adds a Playwright `trace.zip` with `--trace`. Every run writes `events.jsonl`.

**Drift (secondary).** Fingerprint count is checked on every step, even on success, into `driftWarnings`. Ambiguity is the one drift that fails closed.

**Detail:** ARCHITECTURE [§9 Replay](./docs/ARCHITECTURE.md#9-replay), [§20 Outcome taxonomy](./docs/ARCHITECTURE.md#20-outcome-taxonomy), [§14 Mock bank](./docs/ARCHITECTURE.md#14-mock-bank), [§22 Testing](./docs/ARCHITECTURE.md#22-testing) · DIAGRAMS [§4 Replay interpreter](./docs/DIAGRAMS.md#4-replay-interpreter), [§8 Outcome taxonomy](./docs/DIAGRAMS.md#8-outcome-taxonomy) · schema `packages/schema/src/run-result.ts`, [schemas/run-result.v1.json](./schemas/run-result.v1.json) · tests `tests/replay.test.ts` · evidence: success, not-found + trace, permission, timeout + trace, expired, dialog, slow, gated in [evidence/INDEX.md](./evidence/INDEX.md); `evidence/stability.json` (10/10 consecutive replays).

## 4. Heterogeneity & multi-tenant

**Surface abstraction.** The seam between perceiving/acting and the recorded flow is `SurfaceAdapter`. The capability speaks in roles, accessible names, text, frame paths, and checkpoints; the adapter turns those into Playwright calls. A legacy web app with framesets and table layouts is already what MockCore is; `text`/`label` candidates are the fallback when roles are missing. A desktop adapter implements the same interface over the OS accessibility tree (UIA/AX), with `framePath` mapping to window or pane paths. Screenshot coordinates appear only as a discovery hint and as human input in HITL, and are resolved back into a locator via `elementFromPoint` — pixels never enter the artifact.

**Multi-tenant reuse.** One `AppProfile` per vendor product owns entry/expiry checkpoints, interstitial recoveries, and error patterns. A `TenantBinding` (tenant id, profile, base URL, per-step locator overrides) runs the same capability against an institution that renamed a button or moved a route, without re-recording. Per-tenant drift detection is the fingerprint check on every step; a count change is the review signal, ambiguity fails closed. Canonicalization (`/member/12345 → /member/:memberId`) is what discovery already does for recorded waits.

Not built by design: the desktop adapter and the `TenantBinding` runtime. The schema exists, generates to JSON Schema, and is tested so the artifact does not change when the runtime lands.

**Detail:** ARCHITECTURE [§6 SurfaceAdapter](./docs/ARCHITECTURE.md#6-surfaceadapter), [§11 AppProfile](./docs/ARCHITECTURE.md#11-appprofile-and-outcome-detectors), [§24 Explicit cuts](./docs/ARCHITECTURE.md#24-explicit-cuts), [§25 Next](./docs/ARCHITECTURE.md#25-what-we-would-change-next) · code `packages/engine/src/interfaces.ts`, `profiles.ts`; schema `packages/schema/src/tenant.ts`, [schemas/tenant-binding.v1.json](./schemas/tenant-binding.v1.json), [schemas/app-profile.v1.json](./schemas/app-profile.v1.json).

## 5. Escalation & handoff

**Detecting stuck.** Discovery escalates on a stagnant snapshot (three identical accessibility hashes), a repeated identical action, the step/time budget, or a model `escalate`. Replay escalates on an irreversible step without approval or an operator `pauseAfterStep`. Each raises a typed **`InterventionRequest`**: session, capability, goal, current step and `why`, a reason enum (`STAGNANT`, `REPEATED_ACTION`, `BUDGET`, `MODEL_ESCALATE`, `IRREVERSIBLE_GATED`, `REPLAY_UNRECOVERABLE`, `PAUSE_AFTER_STEP`), URL, screenshot ref, and who owns control.

**Taking the live session.** `Session.setOwner("human")` flips control; `WebAdapter.act` throws for the agent. The console (`pnpm serve`) exposes the **same** Playwright page as a frame and forwards clicks as normalized `{nx, ny, viewport}` into it. Every human action is recorded with coordinates and the locator it resolved to. Unanswered and idle timers return ownership so a forgotten ticket does not hold a browser.

**Handing back.** Resume sets the owner to `agent` and calls `replay()` with `skipLaunch` and `resumeFrom = pausedAfter + 1` on the same adapter. Replay tolerates the human having already done the next step and finishes the rest; the result carries the whole event stream across the handoff. A full co-browse console is out of scope; the transfer model, evidence continuity, and resume are implemented and tested.

**Detail:** ARCHITECTURE [§10 Session and HITL](./docs/ARCHITECTURE.md#10-session-and-hitl), [§16 Operator console](./docs/ARCHITECTURE.md#16-operator-console) · DIAGRAMS [§5 HITL same-session](./docs/DIAGRAMS.md#5-hitl-same-session) · code `packages/engine/src/session.ts`, `replay.ts`, `cli/src/serve.ts`; schema `packages/schema/src/intervention.ts` · tests `tests/hitl.test.ts` · evidence [evidence/hitl-local/result.json](./evidence/hitl-local/result.json) (`human_action`, `recovered`, masked `takeover.jpg`); `replay-gated-*`.

## 6. Safety

**Allowlist.** `PolicyGuard` enforces hosts, routes, and action types before the first navigation, on every `framenavigated`, and at the network layer via `page.route` abort, so an off-allowlist redirect is blocked, not merely noticed. Routes match exact-or-child: `/` does not authorize every path; `/lookup` does not authorize `/lookupx`. The snapshot lives on the artifact.

**Risky vs reversible.** Steps carry `riskClass`. Irreversible steps (confirm/submit on the sub-account flow) are refused before the browser is touched unless the capability is `approved` **and** the caller passes `confirmIrreversible`; otherwise the run returns `escalated` / `IRREVERSIBLE_GATED` for a human. Discovery refuses confirm-named clicks without `authorizeIrreversible`. A false stop costs a ticket; a false go costs an account.

**Data handling.** Declared PII moves as `paramRef`. The redactor scrubs declared values, SSN/account patterns, and extracted values from observations, transcripts, and the model's `why`. Screenshots auto-mask fields bound to `pii`/`secret` parameters and their values on the page. Provider keys live only in a Worker secret and a gitignored file. The mock core binds to loopback.

**Limits.** Pixels around a mask can leak context (production: encrypted, short-TTL evidence). The allowlist is declarative, not a sandbox. The redactor is pattern-based and needs parameters declared sensitive. Discovery still sends redacted snapshots to a third-party model; a bank would need a private endpoint or on-prem model.

**Detail:** ARCHITECTURE [§7 PolicyGuard](./docs/ARCHITECTURE.md#7-policyguard), [§12 Redaction](./docs/ARCHITECTURE.md#12-parameters-and-redaction), [§21 Safety model](./docs/ARCHITECTURE.md#21-safety-model) · code `packages/engine/src/policy.ts`, `redact.ts`, `web-adapter.ts`, `compile.ts` (`sensitiveMaskPlan`) · tests `tests/policy.test.ts`, `tests/redact.test.ts` · evidence: masked screenshots in every run; `replay-gated-*`.

## 7. Cuts

Left out, each behind a clean seam: **desktop adapter** (seam: `SurfaceAdapter`); **`TenantBinding` runtime** (schema only); **promote human clicks into a new revision** (actions are recorded with locators; nothing rewrites the artifact); **bounded LLM fallback on replay** (rejected on principle — re-planning in production is the failure mode we argue against; escalate instead); **vendor computer-use toolsets** as a second discovery path; **live browser on the hosted demo** (Container spike documented; recorded-fallback is honest); **real-time co-browse console**.

Stretch goals delivered thin but real: agent-facing invoke (`POST /capabilities/:id/invoke`) with the contract exportable as a function tool; Playwright spec generation from the artifact; the draft/approved gate; route canonicalization; a 10-run stability record. Assisted fallback stays design-only.

Next, in order: `TenantBinding` runtime with a second vendor skin; promote-human-clicks-to-revision behind approval; a UIA desktop adapter against a small WinForms sample; encrypted short-TTL evidence behind `Store`; a per-tenant drift dashboard fed by `driftWarnings`.

**Detail:** ARCHITECTURE [§24 Explicit cuts](./docs/ARCHITECTURE.md#24-explicit-cuts), [§25 Next](./docs/ARCHITECTURE.md#25-what-we-would-change-next) · [apps/worker/SPIKE.md](./apps/worker/SPIKE.md) · DIAGRAMS [§6 Hosted vs local honesty](./docs/DIAGRAMS.md#6-hosted-vs-local-honesty).
