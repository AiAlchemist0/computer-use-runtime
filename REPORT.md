# REPORT

## 1. Architecture

One Node/TypeScript engine runs in the CLI, in tests, and (optionally) in a Cloudflare Container. A `SurfaceAdapter` perceives and acts; a `PolicyGuard` sits in front of every act; a `Session` tracks who owns the live browser (`agent` | `human`). Discover uses an LLM only to pick tools. Replay never calls a model.

The mock bank is a localhost-only Hono app. The console never exposes it as a public URL. Cloudflare Worker + Durable Object + Turnstile are a hosted extra, not required to grade the repo. Persistence is a `Store` interface: files under `/evidence/` locally.

Trade-off: we chose Playwright + the accessibility tree over a vendor computer-use SDK so the artifact we persist is *ours* (typed locators, outcomes, policy), not a vendor transcript. We also chose a bank we own so every runtime exception class is reproducible.

## 2. Artifact schema

A capability is a callable contract: identity, `draft|approved`, `AppProfile` ref, provenance, policy snapshot, typed parameters (`paramRef` + sensitivity), typed outputs, an entry checkpoint, ordered steps (action, locator chain + fingerprint + frame path, `waitFor`, per-step `why`, risk class), `outcomeDetectors`, a success checkpoint, and `knownOutcomes`.

Three layers keep multi-tenant from becoming a blob of overrides: `AppProfile` (vendor product recoveries), `Capability` (the flow), `TenantBinding` (schema only in v1). JSON Schema is generated from Zod 4 and committed in `/schemas`.

Raw member IDs never enter the artifact. The `type` tool takes `paramRef`.

## 3. Determinism & error handling

Replay resolves `role + accessible name` first, then label/text. A chain that matches 0 or 2+ elements fails as `TARGET_NOT_FOUND` or `AMBIGUOUS_TARGET` — never “click the first.” Each step records a `waitFor` from what actually changed. Detectors after the lookup click classify `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`, and `VALIDATION_FAILED` as **business outcomes**. `AppProfile` interstitials and slow loads emit `recovered` events. Session expiry and unexpected state are hard failures with step / expected / observed.

Fingerprint count drift is reported even on success. Chaos (`x-chaos`) is session-scoped so `/lookup` does not drop the failure mode.

## 4. Heterogeneity & multi-tenant

`SurfaceAdapter` is the seam: observe / resolve / act / extract. Today the implementation is Playwright + `ariaSnapshot`. A desktop adapter would implement the same methods against the OS accessibility tree; the capability JSON does not mention CSS or a browser. Screenshot coordinates exist only in discovery, and are immediately turned into a locator via `elementFromPoint`.

Reuse: one `AppProfile` per vendor product; capabilities reference it; `TenantBinding` would override base URL and a few locators. Drift warnings are the detection signal. We did not build a second tenant skin.

## 5. Escalation & handoff

Stuck = unchanged snapshot hash, repeated action, step/time budget, model `escalate`, or an irreversible step without approval. The session sets `controlOwner=human`, agent acts throw, and the console forwards clicks as `{nx,ny}` plus viewport into the **same** Playwright page. Human actions are recorded (coordinates + resolved locator). Resume sets owner back to `agent`. A full co-browse console is out of scope; `pnpm serve` is the thin operator surface.

## 6. Safety

Allowlist is hosts + routes + action types, checked before navigate, on `framenavigated`, and via `page.route` abort. Irreversible steps (confirm/submit) require `status=approved` and `confirmIrreversible` on replay; otherwise we escalate. Logs and artifacts run through a redactor (declared PII, SSN/account patterns). Screenshots can still leak pixels — production would encrypt and short-TTL evidence. Limits: localhost-only target on the demo; no Auth product.

## 7. Cuts

Desktop adapter, `TenantBinding` runtime, promote-human-clicks-to-new-revision, vendor browser toolsets, bounded LLM replay fallback, and hosted Containers if the spike fails. Next: one catalog endpoint (`POST /capabilities/:id/invoke`) and a second branded bank skin to prove tenant overrides.
