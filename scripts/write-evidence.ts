import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Capability } from "@cur/schema";
import {
  discover,
  FakeLlm,
  FileStore,
  isDiscoverComplete,
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
  wipeOldRuns();

  const compiled = await runDiscover(bank.url, bank.port, "compiled");
  const live = await runDiscover(bank.url, bank.port, "live");
  const compiledCap = bindPort(readCapability(compiled), bank.port);
  await store.writeCapability("lookup-savings-balance", { ...compiledCap, id: "lookup-savings-balance", status: "approved" });

  const success = await runReplay(bank.url, bank.port, compiledCap, "12345", false, "success");
  const missing = await runReplay(bank.url, bank.port, compiledCap, "99999", true, "not-found");
  const denied = await runReplay(bank.url, bank.port, compiledCap, "88888", false, "permission");
  const hitl = await runHitl(bank.url, bank.port, compiledCap);

  writeFileSync(
    join(root, "INDEX.md"),
    `# Evidence

- Compiled discovery: \`${compiled}\` — live aria snapshot, scripted tool policy, locators recorded after resolve. This is the complete replayable artifact.
- Live-provider discovery: \`${live ?? "skipped (no LLM_PROVIDER)"}\` — same engine, \`LLM_PROVIDER\` tool loop. Incomplete unless the model finished and extracted.
- Success replay (from compiled capability): \`${success}\`
- Exceptional replay (MEMBER_NOT_FOUND + trace): \`${missing}\`
- Permission replay: \`${denied}\`
- HITL local session: \`hitl-local/\` — pause after type, human Look up via nx/ny, resume extract

The mock bank never leaves localhost. Replay has no model in the loop.
`,
  );

  await bank.close();
  console.log({ compiled, live, success, missing, denied, hitl });
};

const wipeOldRuns = () => {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (name === "capabilities" || name === "INDEX.md") continue;
    rmSync(join(root, name), { recursive: true, force: true });
  }
};

const bindPort = (cap: Capability, port: number): Capability => ({
  ...cap,
  id: "lookup-savings-balance",
  status: "approved",
  policy: loopbackPolicy(port),
});

const readCapability = (dir: string): Capability =>
  JSON.parse(readFileSync(join(root, dir, "capability.json"), "utf8")) as Capability;

const runDiscover = async (target: string, port: number, kind: "compiled" | "live") => {
  const live = kind === "live" ? await tryLiveLlm() : null;
  if (kind === "live" && !live) return null;
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
      llm: live?.llm ?? new FakeLlm(lookupBalanceScript()),
      policy,
      session,
      modelId: live?.modelId ?? "fake+aria-ref",
      maxSteps: kind === "live" ? 8 : 20,
    });
    const finished = out.events.some((e) => e.action === "finish");
    const complete = isDiscoverComplete(out.capability.steps, finished);
    const cap = {
      ...out.capability,
      id: "lookup-savings-balance",
      status: complete ? ("approved" as const) : ("draft" as const),
    };
    const dir = `discovery-${cap.provenance.discoveryRunId.slice(0, 8)}`;
    await store.writeRun(dir, "capability.json", cap);
    await store.writeRun(dir, "steps.json", out.events);
    await store.writeRun(dir, "transcript.redacted.jsonl", `${out.transcript.join("\n")}\n`);
    const shot = await adapter.screenshot({
      mask: [
        {
          candidates: [{ strategy: "role_name", role: "textbox", name: "Member ID", weak: false }],
          fingerprint: { role: "textbox", name: "Member ID", candidateCount: 1, framePath: [] },
          framePath: [],
        },
      ],
    });
    mkdirSync(join(root, dir, "screenshots"), { recursive: true });
    await store.writeBinary(join(dir, "screenshots"), "final.jpg", shot);
    return dir;
  } finally {
    await adapter.close();
  }
};

const tryLiveLlm = async (): Promise<{ llm: Awaited<ReturnType<typeof import("@cur/engine")["createLiveLlm"]>>; modelId: string } | null> => {
  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (!provider || provider === "fake") return null;
  try {
    const { createLiveLlm } = await import("@cur/engine");
    return { llm: await createLiveLlm(), modelId: `${provider}:${process.env.LLM_MODEL ?? "default"}` };
  } catch {
    return null;
  }
};

const runReplay = async (
  target: string,
  port: number,
  capability: Capability,
  memberId: string,
  withTrace: boolean,
  label: string,
) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy, trace: withTrace });
  const session = new Session();
  const dir = `replay-${label}-${Date.now()}`;
  try {
    const result = await replay({
      capability,
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

const runHitl = async (target: string, port: number, capability: Capability) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy });
  const session = new Session();
  const paused = await replay({
    capability,
    values: { memberId: "12345" },
    adapter,
    policy,
    session,
    target,
    pauseAfterStep: 0,
  });
  const page = adapter.pageOrThrow();
  const button = page.getByRole("button", { name: "Look up" });
  const box = await button.boundingBox();
  if (!box) throw new Error("Look up button not visible for HITL evidence");
  const viewport = page.viewportSize() ?? { width: 1100, height: 720 };
  const pointer = {
    nx: (box.x + box.width / 2) / viewport.width,
    ny: (box.y + box.height / 2) / viewport.height,
    viewport,
  };
  const locator = await adapter.elementAtPoint(pointer.nx, pointer.ny, pointer.viewport);
  const beforeClick = await adapter.screenshot();
  await adapter.injectHumanInput("click", pointer);
  session.recordHuman();
  const clickedAt = new Date().toISOString();
  const shot = await adapter.screenshot().catch(() => beforeClick);
  session.setOwner("agent");
  const resumed = await replay({
    capability,
    values: { memberId: "12345" },
    adapter,
    policy,
    session,
    target,
    skipLaunch: true,
    resumeFrom: 1,
  });
  mkdirSync(join(root, "hitl-local", "screenshots"), { recursive: true });
  await store.writeBinary("hitl-local/screenshots", "takeover.jpg", shot);
  await store.writeRun("hitl-local", "result.json", {
    schemaVersion: "1.0.0",
    runId: session.id,
    capabilityId: "lookup-savings-balance",
    status: resumed.status,
    outputs: resumed.outputs,
    events: [
      ...paused.events,
      {
        at: clickedAt,
        kind: "human_action",
        why: "click forwarded as nx,ny plus viewport",
        detail: { ...pointer, locator },
      },
      ...resumed.events,
    ],
    driftWarnings: resumed.driftWarnings,
    evidence: { screenshots: ["evidence/hitl-local/screenshots/takeover.jpg"] },
  });
  await adapter.close();
  return "hitl-local";
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
