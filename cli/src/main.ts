#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discover, FakeLlm, FileStore, lookupBalanceScript, PolicyGuard, replay, seedLookupBalance, Session, WebAdapter, loopbackPolicy } from "@cur/engine";
import { Capability } from "@cur/schema";
import { startServe } from "./serve.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceRoot = join(root, "evidence");

const args = process.argv.slice(2);
const cmd = args[0];

const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
};

const main = async () => {
  if (cmd === "serve") {
    const port = Number(flag("port", process.env.PORT ?? "8787"));
    await startServe(port);
    return;
  }
  if (cmd === "discover") return runDiscover();
  if (cmd === "replay") return runReplay();
  console.log(`Usage:
  pnpm discover --goal "..." --target http://127.0.0.1:4177/ --param memberId=12345
  pnpm replay --artifact evidence/capabilities/lookup-savings-balance.json --param memberId=12345
  pnpm serve`);
};

const parseParams = () => {
  const values: Record<string, string> = {};
  const sensitivity: Record<string, "none" | "pii" | "secret"> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--param" && args[i + 1]?.includes("=")) {
      const [k, v] = args[++i]!.split("=");
      values[k!] = v!;
    }
    if (args[i] === "--sensitivity" && args[i + 1]?.includes("=")) {
      const [k, v] = args[++i]!.split("=");
      sensitivity[k!] = v as "pii";
    }
  }
  return { values, sensitivity };
};

const runDiscover = async () => {
  const goal = flag("goal", "look up the member and read their current savings balance")!;
  const target = flag("target");
  if (!target) throw new Error("--target is required");
  const { values, sensitivity } = parseParams();
  const params = Object.keys(values).map((name) => ({
    name,
    type: "string" as const,
    required: true,
    sensitivity: sensitivity[name] ?? "pii",
    description: name,
  }));
  const port = Number(new URL(target).port || 80);
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy, extraHeaders: chaosHeader() });
  const llmName = flag("llm", process.env.LLM_PROVIDER ?? "fake")!;
  const llm =
    llmName === "fake"
      ? new FakeLlm(lookupBalanceScript())
      : await (await import("@cur/engine")).createLiveLlm?.().catch(async () => {
          const { createLiveLlm } = await import("../../packages/engine/src/live-llm.ts");
          return createLiveLlm();
        });
  const session = new Session();
  try {
    const result = await discover({
      goal,
      target,
      params,
      values,
      adapter,
      llm,
      policy,
      session,
      modelId: `${llmName}:${process.env.LLM_MODEL ?? "fake"}`,
    });
    const cap = { ...result.capability, id: "lookup-savings-balance" };
    const store = new FileStore(evidenceRoot);
    await store.writeCapability(cap.id, cap);
    const dir = `discovery-${cap.provenance.discoveryRunId.slice(0, 8)}`;
    await store.writeRun(dir, "capability.json", cap);
    await store.writeRun(dir, "steps.json", result.events);
    await store.writeRun(
      dir,
      "transcript.redacted.jsonl",
      result.transcript.join("\n") + "\n",
    );
    writeFileSync(join(evidenceRoot, "capabilities", `${cap.id}.json`), `${JSON.stringify(cap, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, artifact: `evidence/capabilities/${cap.id}.json`, steps: result.events }, null, 2));
  } finally {
    await adapter.close();
  }
};

const runReplay = async () => {
  const artifactPath = resolve(
    root,
    flag("artifact", join("evidence", "capabilities", "lookup-savings-balance.json"))!,
  );
  const target = flag("target", "http://127.0.0.1:4177/");
  if (!existsSync(artifactPath)) {
    mkdirSync(join(evidenceRoot, "capabilities"), { recursive: true });
    const seeded = seedLookupBalance(Number(new URL(target!).port || 4177));
    writeFileSync(artifactPath, `${JSON.stringify(seeded, null, 2)}\n`);
  }
  const capability = Capability.parse(JSON.parse(readFileSync(artifactPath, "utf8")));
  const { values } = parseParams();
  const port = Number(new URL(target!).port || 80);
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({ policy, extraHeaders: chaosHeader() });
  const session = new Session();
  const store = new FileStore(evidenceRoot);
  const dir = `replay-${Date.now()}`;
  try {
    const result = await replay({
      capability,
      values,
      adapter,
      policy,
      session,
      target: target!,
      confirmIrreversible: args.includes("--confirm-irreversible"),
    });
    await store.writeResult(dir, result);
    await store.writeRun(dir, "events.jsonl", result.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await adapter.close();
  }
};

const chaosHeader = (): Record<string, string> | undefined => {
  const chaos = flag("chaos");
  return chaos ? { "x-chaos": chaos } : undefined;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
