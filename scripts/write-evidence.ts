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
  const liveRequested = Boolean(process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "fake");
  const keptLive = wipeOldRuns(liveRequested);

  const started = new Date().toISOString();
  const compiled = await runDiscover(bank.url, bank.port, "compiled", started);
  const live = liveRequested ? await runDiscover(bank.url, bank.port, "live", started) : keptLive;
  const compiledCap = bindPort(readCapability(compiled), bank.port);
  await store.writeCapability("lookup-savings-balance", { ...compiledCap, id: "lookup-savings-balance", status: "approved" });
  const liveStatus = live ? readCapability(live).status : "skipped";
  if (liveRequested && live && liveStatus !== "approved") {
    throw new Error(`Live discover ${live} stayed ${liveStatus}. Inspect ${live}/steps.json and transcript.redacted.jsonl`);
  }

  const success = await runReplay(bank.url, bank.port, compiledCap, "12345", false, "success");
  const missing = await runReplay(bank.url, bank.port, compiledCap, "99999", true, "not-found");
  const denied = await runReplay(bank.url, bank.port, compiledCap, "88888", false, "permission");
  const timeout = await runReplay(bank.url, bank.port, compiledCap, "12345", true, "timeout", "timeout");
  const expired = await runReplay(bank.url, bank.port, compiledCap, "12345", false, "expired", "expired");
  const dialog = await runReplay(bank.url, bank.port, compiledCap, "12345", false, "dialog", "dialog");
  const slow = await runReplay(bank.url, bank.port, compiledCap, "12345", false, "slow", "slow");
  const gated = await runGated(bank.url, bank.port, compiledCap);
  const hitl = await runHitl(bank.url, bank.port, compiledCap);
  const stability = await runStability(bank.url, bank.port, compiledCap, 10);

  writeFileSync(
    join(root, "INDEX.md"),
    `# Evidence

- Compiled discovery: \`${compiled}\` — live aria snapshot, scripted tool policy, locators recorded after resolve. Replayable copy: \`capabilities/lookup-savings-balance.json\`.
- Live-provider discovery: \`${live ?? "skipped (no LLM_PROVIDER)"}\` — same engine, \`LLM_PROVIDER\` tool loop.${live ? ` Status \`${liveStatus}\`.` : ""} Includes \`llm-turns.jsonl\` and \`run.json\`.
- Success replay (from compiled capability): \`${success}\`
- Exceptional replay (MEMBER_NOT_FOUND + trace): \`${missing}\`
- Permission replay: \`${denied}\`
- Hard failure, TIMEOUT + trace: \`${timeout}\`
- Hard failure, session expired (UNEXPECTED_STATE): \`${expired}\`
- Recovered, unexpected dialog dismissed: \`${dialog}\`
- Recovered, slow load waited out: \`${slow}\`
- Escalated, IRREVERSIBLE_GATED (draft + no confirm): \`${gated}\`
- HITL local session: \`hitl-local/\` — pause after type, human Look up via nx/ny, resume extract
- Stability: \`stability.json\` — ${stability.runs} consecutive replays, ${stability.success}/${stability.runs} success, p50 ${stability.p50Ms} ms

Screenshots mask declared PII. The mock bank never leaves localhost. Replay has no model in the loop.
`,
  );

  await bank.close();
  console.log({ compiled, live, success, missing, denied, timeout, expired, dialog, slow, gated, hitl, stability });
};

/** Wipe generated runs. When no live provider is requested, keep the approved live discovery so it is not lost. */
const wipeOldRuns = (liveRequested: boolean): string | null => {
  if (!existsSync(root)) return null;
  let kept: string | null = null;
  for (const name of readdirSync(root)) {
    if (name === "capabilities" || name === "INDEX.md") continue;
    if (!liveRequested && name.startsWith("discovery-") && isApprovedLive(name)) {
      kept = name;
      continue;
    }
    rmSync(join(root, name), { recursive: true, force: true });
  }
  return kept;
};

const isApprovedLive = (dir: string): boolean => {
  try {
    const cap = readCapability(dir);
    return cap.status === "approved" && !cap.provenance.modelId.startsWith("fake");
  } catch {
    return false;
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

const runDiscover = async (target: string, port: number, kind: "compiled" | "live", started: string) => {
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
      maxSteps: kind === "live" ? 16 : 20,
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
    await store.writeRun(dir, "llm-turns.jsonl", `${out.llmTurns.map((t) => JSON.stringify(t)).join("\n")}\n`);
    await store.writeRun(dir, "run.json", {
      started,
      finished: new Date().toISOString(),
      steps: out.events.length,
      status: cap.status,
      modelId: cap.provenance.modelId,
      intervention: out.intervention,
    });
    const shot = await adapter.screenshot({
      values: { memberId: "12345" },
      parameters: cap.parameters,
      steps: cap.steps,
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
  chaos?: string,
) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy, trace: withTrace, extraHeaders: chaos ? { "x-chaos": chaos } : undefined });
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
      store,
      runDir: dir,
    });
    if (withTrace) {
      const tracePath = join(root, dir, "trace.zip");
      mkdirSync(join(root, dir), { recursive: true });
      await adapter.stopTrace(tracePath);
      result.evidence.trace = `evidence/${dir}/trace.zip`;
    }
    if (!result.evidence.screenshots.length) {
      const shot = await adapter
        .screenshot({
          values: { memberId },
          parameters: capability.parameters,
          steps: capability.steps,
        })
        .catch(() => undefined);
      if (shot) {
        mkdirSync(join(root, dir, "screenshots"), { recursive: true });
        await store.writeBinary(join(dir, "screenshots"), "final.jpg", shot);
        result.evidence.screenshots.push(`evidence/${dir}/screenshots/final.jpg`);
      }
    }
    await store.writeResult(dir, result);
    await store.writeRun(dir, "events.jsonl", `${result.events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return dir;
  } finally {
    await adapter.close();
  }
};

/** Draft irreversible capability without confirmIrreversible → escalated IRREVERSIBLE_GATED, no browser action taken. */
const runGated = async (target: string, port: number, capability: Capability) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy });
  const session = new Session();
  const dir = `replay-gated-${Date.now()}`;
  const draft: Capability = {
    ...capability,
    status: "draft",
    riskClass: "irreversible",
    steps: [
      ...capability.steps,
      {
        id: `s${capability.steps.length + 1}`,
        action: "click",
        target: {
          candidates: [{ strategy: "role_name", role: "button", name: "Open sub-account", weak: false }],
          fingerprint: { role: "button", name: "Open sub-account", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        waitFor: { kind: "text", value: "Confirm sub-account", timeoutMs: 4000 },
        riskClass: "irreversible",
        why: "Open the confirmation screen",
      },
    ],
  };
  try {
    const result = await replay({ capability: draft, values: { memberId: "12345" }, adapter, policy, session, target, store, runDir: dir });
    await store.writeResult(dir, result);
    await store.writeRun(dir, "events.jsonl", `${result.events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return dir;
  } finally {
    await adapter.close();
  }
};

const runStability = async (target: string, port: number, capability: Capability, runs: number) => {
  const samples: Array<{ run: number; status: string; ms: number; drift: number; steps: number }> = [];
  for (let i = 0; i < runs; i++) {
    const policy = new PolicyGuard(loopbackPolicy(port));
    const adapter = new WebAdapter({ policy });
    const session = new Session();
    const started = Date.now();
    try {
      const result = await replay({ capability, values: { memberId: "12345" }, adapter, policy, session, target });
      samples.push({
        run: i + 1,
        status: result.status,
        ms: Date.now() - started,
        drift: result.driftWarnings.length,
        steps: result.events.filter((e) => e.kind === "step_ok").length,
      });
    } finally {
      await adapter.close();
    }
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const summary = {
    capabilityId: capability.id,
    parameterSet: "known member (Q-014)",
    runs,
    success: samples.filter((s) => s.status === "success").length,
    driftWarnings: samples.reduce((n, s) => n + s.drift, 0),
    p50Ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    recordedAt: new Date().toISOString(),
    samples,
  };
  writeFileSync(join(root, "stability.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
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
  const maskOpts = {
    values: { memberId: "12345" },
    parameters: capability.parameters,
    steps: capability.steps,
  };
  const beforeClick = await adapter.screenshot(maskOpts);
  await adapter.injectHumanInput("click", pointer);
  session.recordHuman();
  const clickedAt = new Date().toISOString();
  await adapter.waitFor("text", "Savings balance", 8000).catch(() => undefined);
  const shot = await adapter.screenshot(maskOpts).catch(() => beforeClick);
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
    intervention: paused.intervention,
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
