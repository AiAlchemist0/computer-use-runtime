# Evidence

- Compiled discovery: `discovery-7b094dcc` — live aria snapshot, scripted tool policy, locators recorded after resolve. Replayable copy: `capabilities/lookup-savings-balance.json`.
- Live-provider discovery: `discovery-4c1ef589` — `zai:glm-5.3-flash` on `https://api.z.ai/api/paas/v4`. Status `approved`.
- Success replay (from compiled capability): `replay-success-1789701267115`
- Exceptional replay (MEMBER_NOT_FOUND + screenshot + `trace.zip`): `replay-not-found-1789701267634`
- Permission replay: `replay-permission-1789701268253`
- HITL local session: `hitl-local/` — pause after type, human Look up via nx/ny, resume extract (`screenshots/takeover.jpg`)

The mock bank never leaves localhost. Replay has no model in the loop.
