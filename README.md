# computer-use-runtime

A capability runtime: an LLM discovers a flow on a live UI once, the run is compiled into a typed artifact, and production replay invokes that artifact **with no model in the decision loop**. When replay cannot safely continue, a human takes over the **same** browser session.

This is the public take-home for interface.ai Assignment A. Clone this repo. Do not need Cloudflare or Supabase to evaluate it.

## Setup

Requires Node 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm exec playwright install chromium
```

No API key is required for tests or the demo path below. The discover loop uses a scripted fake LLM unless you set `LLM_PROVIDER`.

```bash
cp .env.example .env   # optional
```

## Demo path (assignment)

Terminal 1 — mock credit-union core (localhost only):

```bash
pnpm bank
```

Terminal 2 — discover, then replay:

```bash
pnpm discover -- --goal "look up the member and read their current savings balance" --target http://127.0.0.1:4177/ --param memberId=12345 --sensitivity memberId=pii --llm fake

pnpm replay -- --artifact evidence/capabilities/lookup-savings-balance.json --target http://127.0.0.1:4177/ --param memberId=12345

pnpm replay -- --artifact evidence/capabilities/lookup-savings-balance.json --target http://127.0.0.1:4177/ --param memberId=99999
```

Expected: first replay `status: success` with `savingsBalance`; second replay `status: business_outcome` / `MEMBER_NOT_FOUND`.

Human handoff (same live session):

```bash
pnpm serve
```

Open `http://127.0.0.1:8787`. Start live session → Take over → click the frame (`nx`/`ny`) → Resume agent.

## Run without live services

```bash
pnpm test
```

Uses the fake LLM and an in-process bank. No provider key, no Cloudflare.

## Live model (optional)

```bash
export LLM_PROVIDER=openai
export LLM_MODEL=gpt-4.1-mini
export OPENAI_API_KEY=...
pnpm discover -- --goal "..." --target http://127.0.0.1:4177/ --param memberId=12345 --llm openai
```

`LLM_PROVIDER` can be `openai`, `anthropic`, `google`, `xai`, or `openrouter`.

## Layout

- `packages/schema` — Zod 4 capability / result contracts; JSON Schema in `/schemas`
- `packages/engine` — Playwright adapter, policy, discover, replay, HITL session
- `apps/bank` — hostile mock core (tables, iframe, no test IDs), localhost only
- `apps/console` — operator UI
- `apps/worker` — hosted coordinator (recorded fallback if Containers are not live)
- `cli` — `discover` | `replay` | `serve`
- `evidence/` — fake-LLM discovery, success replay, not-found + `trace.zip`, HITL session
- `apps/worker/SPIKE.md` — hosted Container go/no-go; recorded fallback is the live default
- `REPORT.md` — design write-up

## Hosted demo (extra)

- Console: [https://interface.deanshev.com](https://interface.deanshev.com) (recorded-fallback replay)
- Workers.dev: [https://computer-use-runtime.dofusd.workers.dev](https://computer-use-runtime.dofusd.workers.dev)
- Briefing: [https://deanshev.com/interface](https://deanshev.com/interface)

The graded artifact is this repository.
