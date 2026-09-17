# REPORT

## 1. Architecture

One Node/TypeScript engine runs in the CLI, in tests, and (optionally) in a Cloudflare Container. A `SurfaceAdapter` perceives and acts; a `PolicyGuard` sits in front of every act; a `Session` tracks who owns the live browser (`agent` | `human`). Discover uses an LLM only to pick tools. Replay never calls a model.

The mock bank is a localhost-only Hono app. The console never exposes it as a public URL. Cloudflare Worker + Durable Object + Turnstile are a hosted extra, not required to grade the repo. Persistence is a `Store` interface: files under `/evidence/` locally.

We did not use Stagehand or Browserbase. Their `observe() → Action → act(Action)` cache is the same thesis as a product. Ours differs: typed inputs/outputs, first-class business-outcome detectors, a policy snapshot on the artifact, a same-session HITL seam, no vendor-hosted cache, and a Playwright adapter we own. Vendor computer-use toolsets (Anthropic `browser_toolset`, OpenAI CUA) are a possible future `SurfaceAdapter`, not v1. The discover contract is our Zod tools plus `LLM_PROVIDER`.

Trade-off: Playwright + the accessibility tree over a vendor SDK so the artifact is ours. We own the bank so every exception class is reproducible.

## 2. Artifact schema

A capability is a callable contract: identity, `draft|approved`, `AppProfile` ref, provenance, policy snapshot, typed parameters (`paramRef` + sensitivity), typed outputs, an entry checkpoint, ordered steps (action, locator chain + fingerprint + frame path, `waitFor`, per-step `why`, risk class), `outcomeDetectors`, a success checkpoint, and `knownOutcomes`.

Three layers keep multi-tenant from becoming a blob of overrides: `AppProfile` (vendor product recoveries), `Capability` (the flow), `TenantBinding` (schema only in v1). JSON Schema is generated from Zod 4 and committed in `/schemas`.

Raw member IDs never enter the artifact. The `type` tool takes `paramRef`. Discover records the locator after resolving an aria `[ref=eN]` (or role+name fallback).

## 3. Determinism & error handling

Replay resolves `role + accessible name` first, then label/text. A chain that matches 0 or 2+ elements fails as `TARGET_NOT_FOUND` or `AMBIGUOUS_TARGET` — never “click the first.” Each step records a `waitFor` from what actually changed. Detectors after the lookup click classify `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`, and `VALIDATION_FAILED` as **business outcomes**. `AppProfile` interstitials and slow loads emit `recovered` events. Session expiry and unexpected state are hard failures with step / expected / observed.

Fingerprint count drift is reported even on success. Chaos (`x-chaos`) is session-scoped so `/lookup` does not drop the failure mode.

## 4. Heterogeneity & multi-tenant

`SurfaceAdapter` is the seam: observe / resolve / act / extract. Today the implementation is Playwright + `ariaSnapshot` (AI mode / refs when the runtime supports them). A desktop adapter would implement the same methods against the OS accessibility tree; the capability JSON does not mention CSS or a browser. Screenshot coordinates exist only in discovery and HITL, and are immediately turned into a locator via `elementFromPoint`.

Reuse: one `AppProfile` per vendor product; capabilities reference it; `TenantBinding` would override base URL and a few locators. Drift warnings are the detection signal. We did not build a second tenant skin.

## 5. Escalation & handoff

Stuck = unchanged snapshot hash, repeated action, step/time budget, model `escalate`, or an irreversible step without approval. The session sets `controlOwner=human`, agent acts throw, and the console forwards clicks as `{nx,ny}` plus viewport into the **same** Playwright page. Human actions are recorded (coordinates + resolved locator). Resume sets owner back to `agent`. A full co-browse console is out of scope; `pnpm serve` is the thin operator surface.

## 6. Safety

Allowlist is hosts + routes + action types, checked before navigate, on `framenavigated`, and via `page.route` abort. Irreversible steps (confirm/submit) require `status=approved` and `confirmIrreversible` on replay; otherwise we escalate. Logs and artifacts run through a redactor (declared PII, SSN/account patterns). Screenshots accept Playwright `mask` locators for sensitive fields. Residual limit: pixels can still leak; production would encrypt and short-TTL evidence. The demo target is localhost-only. No Auth product.

## 7. Cuts

Desktop adapter, `TenantBinding` runtime, promote-human-clicks-to-new-revision, vendor browser toolsets as a second discovery path, bounded LLM replay fallback, and a live Cloudflare Container (the hosted site is recorded-fallback replay; see `apps/worker/SPIKE.md`). `@cloudflare/playwright` inside a Worker was the earlier plan and is the fallback if a later Container spike fails. `POST /capabilities/:id/invoke` exists on the local console as the agent-facing call shape.
