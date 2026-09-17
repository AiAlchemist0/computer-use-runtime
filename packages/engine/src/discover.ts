import { createHash, randomUUID } from "node:crypto";
import type { Capability, CapabilityStep, LocatorChain, Parameter } from "@cur/schema";
import { deriveChain, WebAdapter } from "./web-adapter.js";
import { PolicyGuard, PolicyDenied } from "./policy.js";
import type { DiscoverLlm } from "./llm.js";
import type { Session } from "./session.js";
import { mockBankProfile } from "./profiles.js";
import { redactText } from "./redact.js";

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

  await input.adapter.launch(input.target);
  input.policy.assertNavigate(input.target);

  for (let i = 0; i < maxSteps; i++) {
    if (Date.now() > deadline) break;
    input.session.assertAgent();
    const obs = await input.adapter.observe();
    const snapHash = hash(obs.aria);
    if (snapHash === lastHash) stagnant += 1;
    else stagnant = 0;
    lastHash = snapHash;
    if (stagnant >= 3) break;

    const observation = redactText(
      `url=${obs.url}\ntitle=${obs.title}\n${obs.aria}`,
      input.params,
      input.values,
    );
    const turn = await input.llm.next({ goal: input.goal, observation, history });
    const call = turn.toolCalls[0];
    if (!call) break;
    const why = String(call.arguments.why ?? turn.text ?? call.name);
    history.push(`${call.name}: ${why}`);
    transcript.push(JSON.stringify({ tool: call.name, why, args: call.arguments }));

    if (call.name === "finish") {
      events.push({ action: "finish", why });
      break;
    }
    if (call.name === "escalate") {
      events.push({ action: "escalate", why });
      break;
    }

    const action = call.name as CapabilityStep["action"];
    if (action === "click" && String(call.arguments.name ?? "").toLowerCase().includes("confirm")) {
      if (!input.authorizeIrreversible) {
        throw new PolicyDenied("irreversible step not authorized", { action });
      }
    }

    const paramRef = call.arguments.paramRef ? String(call.arguments.paramRef) : undefined;
    const rawValue = paramRef ? input.values[paramRef] : call.arguments.value != null ? String(call.arguments.value) : undefined;

    const page = input.adapter.pageOrThrow();
    const chain: LocatorChain | undefined =
      call.arguments.role || call.arguments.name
        ? await deriveChain(page, action, {
            role: call.arguments.role ? String(call.arguments.role) : undefined,
            name: call.arguments.name ? String(call.arguments.name) : undefined,
            label: call.arguments.label ? String(call.arguments.label) : undefined,
          })
        : undefined;

    const sig = `${action}:${chain?.candidates[0]?.name ?? ""}`;
    if (sig === lastAction) stagnant += 1;
    lastAction = sig;

    await input.adapter.act({ action, target: chain, value: rawValue });
    const url = await input.adapter.url();
    const pathname = new URL(url).pathname;
    const leaked = Object.values(input.values).some((v) => v && pathname.includes(v));
    const waitFor =
      url !== obs.url && !leaked
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
  const capability: Capability = {
    schemaVersion: "1.0.0",
    id: `lookup-savings-${hash(input.goal).slice(0, 6)}`,
    name: "lookup_savings_balance",
    description: input.goal,
    revision: 1,
    status: "draft",
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
    outcomeDetectors: [
      {
        afterStep: 1,
        locator: {
          candidates: [{ strategy: "text", text: "No such member", weak: false }],
          fingerprint: { name: "No such member", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        pattern: "No such member",
        outcome: "MEMBER_NOT_FOUND",
      },
      {
        afterStep: 1,
        locator: {
          candidates: [{ strategy: "text", text: "Permission denied", weak: false }],
          fingerprint: { name: "Permission denied", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        pattern: "Permission denied",
        outcome: "PERMISSION_DENIED",
      },
      {
        afterStep: 1,
        locator: {
          candidates: [{ strategy: "text", text: "Member ID must be", weak: false }],
          fingerprint: { name: "Member ID must be", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        pattern: "Member ID must be",
        outcome: "VALIDATION_FAILED",
      },
    ],
    success: { kind: "text", value: "Savings balance" },
    knownOutcomes: [
      { code: "MEMBER_NOT_FOUND", description: "No member exists for the supplied ID" },
      { code: "PERMISSION_DENIED", description: "Operator is not allowed to view this record" },
      { code: "VALIDATION_FAILED", description: "Member ID failed field validation" },
    ],
  };

  return { capability, events, transcript };
};
