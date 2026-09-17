import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  discover,
  FakeLlm,
  FileStore,
  lookupBalanceScript,
  PolicyGuard,
  replay,
  seedLookupBalance,
  Session,
  WebAdapter,
  loopbackPolicy,
} from "@cur/engine";
import { startBank } from "../tests/helpers.ts";

const root = join(process.cwd(), "evidence");
const store = new FileStore(root);

const main = async () => {
  const bank = await startBank();
  const cap = seedLookupBalance(bank.port);
  await store.writeCapability(cap.id, cap);

  const discovery = await runDiscover(bank.url, bank.port);
  const success = await runReplay(bank.url, bank.port, "12345", false);
  const missing = await runReplay(bank.url, bank.port, "99999", true);
  const hitl = await runHitl(bank.url, bank.port);

  writeFileSync(join(root, "INDEX.md"), `# Evidence

- Discovery: \`${discovery}\`
- Success replay: \`${success}\`
- Exceptional replay (MEMBER_NOT_FOUND + trace): \`${missing}\`
- HITL local session: \`hitl-local/\`

Generated with the fake LLM against the localhost mock core. No provider key required.
`);

  await bank.close();
  console.log({ discovery, success, missing, hitl });
};

const runDiscover = async (target: string, port: number) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy });
  const session = new Session();
  try {
    const out = await discover({
      goal: "look up the member and read their current savings balance",
      target,
      params: [{ name: "memberId", type: "string", required: true, sensitivity: "pii", description: "id" }],
      values: { memberId: "12345" },
      adapter,
      llm: new FakeLlm(lookupBalanceScript()),
      policy,
      session,
      modelId: "fake",
    });
    const cap = { ...out.capability, status: "approved" as const, id: "lookup-savings-balance" };
    const dir = `discovery-${cap.provenance.discoveryRunId.slice(0, 8)}`;
    await store.writeRun(dir, "capability.json", cap);
    await store.writeRun(dir, "steps.json", out.events);
    await store.writeRun(dir, "transcript.redacted.jsonl", `${out.transcript.join("\n")}\n`);
    const shot = await adapter.screenshot();
    mkdirSync(join(root, dir, "screenshots"), { recursive: true });
    await store.writeBinary(join(dir, "screenshots"), "final.jpg", shot);
    return dir;
  } finally {
    await adapter.close();
  }
};

const runReplay = async (target: string, port: number, memberId: string, withTrace: boolean) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy, trace: withTrace });
  const session = new Session();
  const dir = memberId === "12345" ? `replay-success-${Date.now()}` : `replay-not-found-${Date.now()}`;
  try {
    const result = await replay({
      capability: seedLookupBalance(port),
      values: { memberId },
      adapter,
      policy,
      session,
      target,
    });
    if (withTrace) {
      const tracePath = join(root, dir, "trace.zip");
      mkdirSync(join(root, dir), { recursive: true });
      await adapter.stopTrace(tracePath);
      result.evidence.trace = `evidence/${dir}/trace.zip`;
    }
    const shot = await adapter.screenshot().catch(() => undefined);
    if (shot) {
      mkdirSync(join(root, dir, "screenshots"), { recursive: true });
      await store.writeBinary(join(dir, "screenshots"), "final.jpg", shot);
      result.evidence.screenshots.push(`evidence/${dir}/screenshots/final.jpg`);
    }
    await store.writeResult(dir, result);
    await store.writeRun(dir, "events.jsonl", `${result.events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return dir;
  } finally {
    await adapter.close();
  }
};

const runHitl = async (target: string, port: number) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy });
  const session = new Session();
  await adapter.launch(target);
  session.setOwner("human");
  const pointer = { nx: 0.42, ny: 0.38, viewport: { width: 1100, height: 720 } };
  await adapter.injectHumanInput("click", pointer);
  session.recordHuman();
  const locator = await adapter.elementAtPoint(pointer.nx, pointer.ny, pointer.viewport);
  const shot = await adapter.screenshot();
  mkdirSync(join(root, "hitl-local", "screenshots"), { recursive: true });
  await store.writeBinary("hitl-local/screenshots", "takeover.jpg", shot);
  await store.writeRun("hitl-local", "result.json", {
    schemaVersion: "1.0.0",
    runId: session.id,
    capabilityId: "lookup-savings-balance",
    status: "escalated",
    events: [
      { at: new Date().toISOString(), kind: "escalation_requested", why: "operator takeover requested" },
      {
        at: new Date().toISOString(),
        kind: "human_action",
        why: "click forwarded as nx,ny plus viewport",
        detail: { ...pointer, locator },
      },
      { at: new Date().toISOString(), kind: "human_resume", why: "operator returned control" },
    ],
    driftWarnings: [],
    evidence: { screenshots: ["evidence/hitl-local/screenshots/takeover.jpg"] },
  });
  session.setOwner("agent");
  await adapter.close();
  return "hitl-local";
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
