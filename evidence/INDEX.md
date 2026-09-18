# Evidence

- Compiled discovery: `discovery-566f9f39` — live aria snapshot, scripted tool policy, locators recorded after resolve. This is the complete replayable artifact.
- Live-provider discovery: `discovery-fe5c1ff1` — same engine, `LLM_PROVIDER` tool loop. **Draft / incomplete** (no finish + extract). The compiled run is the replayable artifact.
- Success replay (from compiled capability): `replay-success-1789689699793`
- Exceptional replay (MEMBER_NOT_FOUND + trace): `replay-not-found-1789689700192`
- Permission replay: `replay-permission-1789689700722`
- HITL local session: `hitl-local/` — pause after type, human Look up via nx/ny, resume extract

The mock bank never leaves localhost. Replay has no model in the loop.
