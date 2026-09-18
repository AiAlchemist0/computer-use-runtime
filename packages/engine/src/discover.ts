import { createHash, randomUUID } from "node:crypto";
import type { Capability, CapabilityStep, LocatorChain, Parameter } from "@cur/schema";
import { deriveChain, deriveChainFromRef, parseAriaRefs, WebAdapter } from "./web-adapter.js";
import { PolicyGuard, PolicyDenied } from "./policy.js";
import type { DiscoverLlm } from "./llm.js";
import type { Session } from "./session.js";
import { mockBankProfile } from "./profiles.js";
import { redactText } from "./redact.js";
import { coerceParamRef, isDiscoverComplete } from "./params.js";

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
  events: Array<{ why: string; action: string }>;
  transcript: string[];
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const discover = async (input: DiscoverInput): Promise<DiscoverOutput> => {
  const maxSteps = input.maxSteps ?? 20;
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  const steps: CapabilityStep[] = [];
  const transcript: string[] = [];
  const events: Array<{ why: string; action: string }> = [];
  const history: string[] = [];
  let lastHash = "";
  let stagnant = 0;
  let lastAction = "";
  let finished = false;

  input.adapter.bindSession(input.session);
  await input.adapter.launch(input.target);
  input.policy.assertNavigate(input.target);

  const escalate = (why: string) => {
    input.session.setOwner("human");
    events.push({ action: "escalate", why });
    history.push(`escalate: ${why}`);
  };

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() > deadline) break;
    input.session.assertAgent();
    const obs = await input.adapter.observe();
    const snapHash = hash(obs.aria);
    if (snapHash === lastHash) stagnant += 1;
    else stagnant = 0;
    lastHash = snapHash;
    if (stagnant >= 3) {
      escalate("stagnant snapshot; operator takeover");
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
    const why = String(call.arguments.why ?? turn.text ?? call.name);

    if (call.name === "finish") {
      finished = true;
      events.push({ action: "finish", why });
      history.push(`finish: ${why}`);
      transcript.push(JSON.stringify({ tool: call.name, why, args: call.arguments }));
      break;
    }
    if (call.name === "escalate") {
      transcript.push(JSON.stringify({ tool: call.name, why, args: call.arguments }));
      escalate(why);
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

    const sig = `${action}:${chain?.candidates[0]?.name ?? ""}`;
    if (sig === lastAction) stagnant += 1;
    lastAction = sig;

    await input.adapter.act({ action, target: chain, value: rawValue });
    const url = await input.adapter.url();
    const pathname = new URL(url).pathname;
    const leaked = Object.values(input.values).some((v) => v && pathname.includes(v));
    const changed = url !== obs.url;
    history.push(`${call.name}: ${why}`);
    history.push(changed ? `page: url changed to ${leaked ? "[redacted]" : pathname}` : "page: unchanged — do a different action");
    transcript.push(JSON.stringify({ tool: call.name, why, args: { ...call.arguments, paramRef, value: paramRef ? undefined : call.arguments.value } }));

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
  const clickIndex = steps.findIndex((s) => s.action === "click");
  const afterStep = clickIndex >= 0 ? clickIndex : Math.max(0, steps.length - 1);
  const complete = isDiscoverComplete(steps, finished);
  const capability: Capability = {
    schemaVersion: "1.0.0",
    id: `lookup-savings-${hash(input.goal).slice(0, 6)}`,
    name: "lookup_savings_balance",
    description: input.goal,
    revision: 1,
    status: complete ? "approved" : "draft",
    appProfile: profile.id,
    provenance: {
      discoveryRunId: randomUUID(),
      modelId: input.modelId,
      createdAt: new Date().toISOString(),
      sourceHash: hash(JSON.stringify(steps)),
    },
    riskClass: "reversible",
    policy: input.policy.snapshot(),
    parameters: input.params,
    outputs: [{ name: "savingsBalance", type: "string", sensitivity: "none", description: "Current savings balance" }],
    entry: profile.entry,
    steps,
    outcomeDetectors: profile.errorPatterns
      .filter((p) =>
        ["MEMBER_NOT_FOUND", "PERMISSION_DENIED", "ACCOUNT_FROZEN", "ESTATE_HOLD", "VALIDATION_FAILED"].includes(p.code),
      )
      .map((p) => ({
        afterStep,
        locator: {
          candidates: [{ strategy: "text" as const, text: p.pattern, weak: false }],
          fingerprint: { name: p.pattern, candidateCount: 1, framePath: [] as string[] },
          framePath: [] as string[],
        },
        pattern: p.pattern,
        outcome: p.code,
      })),
    success: { kind: "text", value: "Savings balance" },
    knownOutcomes: [
      { code: "MEMBER_NOT_FOUND", description: "No member exists for the supplied ID" },
      { code: "PERMISSION_DENIED", description: "Operator is not allowed to view this record" },
      { code: "ACCOUNT_FROZEN", description: "Fraud or operational freeze blocks servicing" },
      { code: "ESTATE_HOLD", description: "Deceased member — supervisor and letters required" },
      { code: "VALIDATION_FAILED", description: "Member ID failed field validation" },
    ],
  };

  return { capability, events, transcript };
};
