import { createHash, randomUUID } from "node:crypto";
import type { Capability, CapabilityStep, InterventionRequest, LocatorChain, Parameter } from "@cur/schema";
import { annotateFramePath, deriveChain, deriveChainFromRef, parseAriaRefs, WebAdapter } from "./web-adapter.js";
import { PolicyGuard, PolicyDenied } from "./policy.js";
import type { DiscoverLlm, LlmTurnRecord } from "./llm.js";
import type { Session } from "./session.js";
import { mockBankProfile } from "./profiles.js";
import { redactText } from "./redact.js";
import { coerceParamRef, isDiscoverComplete } from "./params.js";
import { compileDiscoveredSteps, detectorsFromProfile, knownOutcomesFromProfile, slugFromGoal } from "./compile.js";

export type DiscoverInput = {
  goal: string;
  target: string;
  params: Parameter[];
  values: Record<string, string>;
  adapter: WebAdapter;
  llm: DiscoverLlm;
  policy: PolicyGuard;
  session: Session;
  modelId: string;
  maxSteps?: number;
  timeoutMs?: number;
  authorizeIrreversible?: boolean;
};

export type DiscoverOutput = {
  capability: Capability;
  events: Array<{ why: string; action: string; kind?: string }>;
  transcript: string[];
  llmTurns: LlmTurnRecord[];
  intervention?: InterventionRequest;
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const discover = async (input: DiscoverInput): Promise<DiscoverOutput> => {
  const maxSteps = input.maxSteps ?? 20;
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  const steps: CapabilityStep[] = [];
  const transcript: string[] = [];
  const llmTurns: LlmTurnRecord[] = [];
  const events: Array<{ why: string; action: string; kind?: string }> = [];
  const history: string[] = [];
  const extractedValues: string[] = [];
  let lastHash = "";
  let stagnant = 0;
  let lastAction = "";
  let finished = false;
  let intervention: InterventionRequest | undefined;

  input.adapter.bindSession(input.session);
  await input.adapter.launch(input.target);
  input.policy.assertNavigate(input.target);

  const escalate = (why: string, reason: InterventionRequest["reason"]) => {
    input.session.setOwner("human");
    events.push({ action: "escalate", why, kind: "escalation_requested" });
    history.push(`escalate: ${why}`);
    intervention = {
      sessionId: input.session.id,
      capabilityId: slugFromGoal(input.goal),
      goal: input.goal,
      stepIndex: Math.max(0, steps.length - 1),
      stepWhy: steps.at(-1)?.why,
      reason,
      why,
      controlOwner: "human",
      requestedAt: new Date().toISOString(),
    };
  };

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() > deadline) {
      escalate("discover step/time budget exhausted", "BUDGET");
      break;
    }
    input.session.assertAgent();
    const obs = await input.adapter.observe();
    const snapHash = hash(obs.aria);
    const lastStepWasExtract = steps.at(-1)?.action === "extract";
    if (snapHash === lastHash && !lastStepWasExtract) stagnant += 1;
    else if (snapHash !== lastHash) stagnant = 0;
    lastHash = snapHash;
    if (stagnant >= 3) {
      escalate("stagnant snapshot; operator takeover", lastAction ? "REPEATED_ACTION" : "STAGNANT");
      break;
    }

    const observation = redactText(
      `url=${obs.url}\ntitle=${obs.title}\n${obs.aria}`,
      input.params,
      input.values,
    );
    const turn = await input.llm.next({
      goal: input.goal,
      observation,
      history,
      params: input.params,
    });
    const call = turn.toolCalls[0];
    if (!call) break;
    llmTurns.push({
      at: new Date().toISOString(),
      modelId: input.modelId,
      toolName: call.name,
      meta: turn.meta,
    });
    const why = redactText(String(call.arguments.why ?? turn.text ?? call.name), input.params, input.values, extractedValues);

    const redactArgs = (args: Record<string, unknown>) =>
      JSON.parse(redactText(JSON.stringify(args), input.params, input.values, extractedValues)) as Record<string, unknown>;

    if (call.name === "finish") {
      finished = true;
      events.push({ action: "finish", why });
      history.push(`finish: ${why}`);
      transcript.push(JSON.stringify({ tool: call.name, why, args: redactArgs(call.arguments) }));
      break;
    }
    if (call.name === "escalate") {
      transcript.push(JSON.stringify({ tool: call.name, why, args: redactArgs(call.arguments) }));
      escalate(why, "MODEL_ESCALATE");
      break;
    }

    const action = call.name as CapabilityStep["action"];
    if (action === "click" && String(call.arguments.name ?? "").toLowerCase().includes("confirm")) {
      if (!input.authorizeIrreversible) {
        throw new PolicyDenied("irreversible step not authorized", { action });
      }
    }

    let paramRef: string | undefined;
    try {
      paramRef = coerceParamRef(call.arguments, input.params);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "UNKNOWN_PARAM_REF") throw err;
      throw err;
    }
    const rawValue = paramRef
      ? input.values[paramRef]
      : call.arguments.value != null && !String(call.arguments.value).startsWith("paramRef")
        ? String(call.arguments.value)
        : undefined;

    const page = input.adapter.pageOrThrow();
    const refs = parseAriaRefs(obs.aria);
    if (!call.arguments.ref && (call.arguments.role || call.arguments.name)) {
      const hit = refs.find(
        (r) =>
          (!call.arguments.name || r.name === String(call.arguments.name)) &&
          (!call.arguments.role || r.role === String(call.arguments.role) || (call.arguments.role === "textbox" && r.role === "textbox")),
      );
      if (hit) call.arguments.ref = hit.ref;
    }
    const hint = {
      role: call.arguments.role ? String(call.arguments.role) : undefined,
      name: call.arguments.name ? String(call.arguments.name) : undefined,
      label: call.arguments.label ? String(call.arguments.label) : undefined,
    };
    let chain: LocatorChain | undefined;
    if (call.arguments.ref) {
      try {
        chain = await deriveChainFromRef(page, String(call.arguments.ref));
      } catch {
        chain = hint.role || hint.name ? await deriveChain(page, action, hint) : undefined;
      }
    } else if (hint.role || hint.name) {
      chain = await deriveChain(page, action, hint);
    }
    if (chain) chain = await annotateFramePath(page, chain);

    const sig = `${action}:${chain?.candidates[0]?.name ?? ""}`;
    if (sig === lastAction && action !== "extract") stagnant += 1;
    lastAction = sig;

    await input.adapter.act({ action, target: chain, value: rawValue });
    if (action === "extract" && chain) {
      const extracted = await input.adapter.extract(chain).catch(() => undefined);
      if (extracted?.text) extractedValues.push(extracted.text);
    }
    const url = await input.adapter.url();
    const pathname = new URL(url).pathname;
    const leaked = Object.values(input.values).some((v) => v && pathname.includes(v));
    const changed = url !== obs.url;
    history.push(`${call.name}: ${why}`);
    history.push(changed ? `page: url changed to ${leaked ? "[redacted]" : pathname}` : "page: unchanged — do a different action");
    transcript.push(
      JSON.stringify({
        tool: call.name,
        why,
        args: redactArgs({ ...call.arguments, paramRef, value: paramRef ? undefined : call.arguments.value }),
      }),
    );

    const waitFor =
      changed && !leaked
        ? { kind: "url" as const, value: pathname, timeoutMs: 8000 }
        : { kind: "load" as const, timeoutMs: 8000 };
    await input.adapter.waitFor(waitFor.kind, waitFor.value, waitFor.timeoutMs).catch(() => undefined);

    steps.push({
      id: `s${steps.length + 1}`,
      action,
      target: chain,
      input: paramRef ? { kind: "paramRef", param: paramRef } : rawValue != null ? { kind: "value", value: rawValue } : undefined,
      outputName: call.arguments.outputName ? String(call.arguments.outputName) : undefined,
      waitFor,
      riskClass: action === "click" && String(call.arguments.name ?? "").includes("Confirm") ? "irreversible" : "reversible",
      why,
    });
    events.push({ action, why });
  }

  const profile = mockBankProfile();
  const compiled = compileDiscoveredSteps({ goal: input.goal, steps, profile });
  const clickIndex = compiled.steps.findIndex((s) => s.action === "click");
  const afterStep = clickIndex >= 0 ? clickIndex : Math.max(0, compiled.steps.length - 1);
  const complete = isDiscoverComplete(compiled.steps, finished);
  const capability: Capability = {
    schemaVersion: "1.0.0",
    id: compiled.id,
    name: compiled.name,
    description: input.goal,
    revision: 1,
    status: complete ? "approved" : "draft",
    appProfile: profile.id,
    provenance: {
      discoveryRunId: randomUUID(),
      modelId: input.modelId,
      createdAt: new Date().toISOString(),
      sourceHash: hash(JSON.stringify(compiled.steps)),
    },
    riskClass: "reversible",
    policy: input.policy.snapshot(),
    parameters: input.params,
    outputs: compiled.outputs,
    entry: profile.entry,
    steps: compiled.steps,
    outcomeDetectors: detectorsFromProfile(profile, afterStep),
    success: compiled.success,
    knownOutcomes: knownOutcomesFromProfile(profile),
  };
  if (intervention) {
    intervention.capabilityId = capability.id;
    intervention.url = await input.adapter.url().catch(() => undefined);
  }

  return { capability, events, transcript, llmTurns, intervention };
};
