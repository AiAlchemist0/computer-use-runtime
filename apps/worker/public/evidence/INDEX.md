# Evidence

- Compiled discovery: `discovery-18f64735` — live aria snapshot, scripted tool policy, locators recorded after resolve. Replayable copy: `capabilities/lookup-savings-balance.json`.
- Live-provider discovery: `discovery-9cec3e54` — same engine, `LLM_PROVIDER` tool loop. Status `approved`. Includes `llm-turns.jsonl` and `run.json`.
- Success replay (from compiled capability): `replay-success-1789710346349`
- Exceptional replay (MEMBER_NOT_FOUND + trace): `replay-not-found-1789710346869`
- Permission replay: `replay-permission-1789710347468`
- Hard failure, TIMEOUT + trace: `replay-timeout-1789710347885`
- Hard failure, session expired (UNEXPECTED_STATE): `replay-expired-1789710348605`
- Recovered, unexpected dialog dismissed: `replay-dialog-1789710349047`
- Recovered, slow load waited out: `replay-slow-1789710349652`
- Escalated, IRREVERSIBLE_GATED (draft + no confirm): `replay-gated-1789710359296`
- HITL local session: `hitl-local/` — pause after type, human Look up via nx/ny, resume extract
- Stability: `stability.json` — 10 consecutive replays, 10/10 success, p50 412 ms

Screenshots mask declared PII. The mock bank never leaves localhost. Replay has no model in the loop.
