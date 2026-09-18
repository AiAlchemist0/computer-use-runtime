# Container spike (M4)

Hosted default is **recorded-fallback replay**. The Worker + Durable Object + Turnstile + kill switch ship without a live Chromium.

## Go / no-go

| Check | Result |
| ----- | ------ |
| Worker + Assets + SessionCoordinator DO | Implemented. Replay is recorded from `/evidence`. |
| Turnstile | Enforced on `/api/replay` and invoke only when `TURNSTILE_SECRET_KEY` is set. No widget is shipped without a sitekey. |
| Kill switch | `DEMO_ENABLED=false` refuses `/api/replay` and invoke with 503. |
| Daily budget | `/api/replay` locks the DO, increments `DAILY_SESSION_BUDGET`, then unlocks. |
| Cloudflare Container + Chromium | Optional. `Dockerfile` is the spike target. Cold start, WS forwarding, and sleep/wake are **not** the default path. |
| Supabase catalog | Optional and unused. Filesystem `Store` is the graded persistence. |

If a later spike shows Container cold start + screenshot polling is acceptable, bind `EngineContainer` and keep this Worker as the coordinator. Until then, `interface.deanshev.com` serves recorded replay so the page is never broken.

Custom domain: CNAME `interface` → this Worker, proxied. Apex Pages for `deanshev.com` stays DNS-only.
