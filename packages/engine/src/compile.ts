import type {
  AppProfile,
  CapabilityStep,
  Checkpoint,
  OutcomeCode,
  OutcomeDetector,
  OutputField,
  Parameter,
} from "@cur/schema";
import { OutcomeCode as OutcomeCodeSchema } from "@cur/schema";

const fold = (s: string) => s.toLowerCase().replace(/[_-]/g, "");

const OUTCOME_CODES = new Set<string>(OutcomeCodeSchema.options);

export const toCamelIdent = (raw: string): string => {
  const camel = raw
    .trim()
    .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  return camel ? camel.replace(/^[A-Z]/, (c) => c.toLowerCase()) : "value";
};

export const normalizeOutputName = (raw: string, declared: OutputField[] = []): string => {
  const camel = toCamelIdent(raw);
  const hit = declared.find((o) => fold(o.name) === fold(raw) || fold(o.name) === fold(camel));
  return hit?.name ?? camel;
};

export const slugFromGoal = (goal: string): string =>
  goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "") || "capability";

const locatorKey = (s: CapabilityStep): string =>
  `${s.action}:${s.target?.fingerprint.role ?? ""}:${s.target?.fingerprint.name ?? s.target?.candidates[0]?.name ?? ""}`;

export const collapseRepeatedExtracts = (steps: CapabilityStep[]): CapabilityStep[] => {
  const out: CapabilityStep[] = [];
  for (const step of steps) {
    const prev = out.at(-1);
    if (step.action === "extract" && prev?.action === "extract" && locatorKey(step) === locatorKey(prev)) {
      if (step.outputName && !prev.outputName) {
        out[out.length - 1] = { ...prev, outputName: step.outputName };
      }
      continue;
    }
    out.push(step);
  }
  return out.map((s, i) => ({ ...s, id: `s${i + 1}` }));
};

const OUTCOME_HELP: Record<string, string> = {
  MEMBER_NOT_FOUND: "No member exists for the supplied ID",
  PERMISSION_DENIED: "Operator is not allowed to view this record",
  ACCOUNT_FROZEN: "Fraud or operational freeze blocks servicing",
  ESTATE_HOLD: "Deceased member — supervisor and letters required",
  VALIDATION_FAILED: "Member ID failed field validation",
  SESSION_EXPIRED: "The operator session expired",
  UNEXPECTED_DIALOG: "An unexpected confirmation or notice blocked the flow",
};

const BUSINESS_DETECTORS = new Set([
  "MEMBER_NOT_FOUND",
  "PERMISSION_DENIED",
  "ACCOUNT_FROZEN",
  "ESTATE_HOLD",
  "VALIDATION_FAILED",
]);

export const detectorsFromProfile = (profile: AppProfile, afterStep: number): OutcomeDetector[] =>
  profile.errorPatterns
    .filter((p) => BUSINESS_DETECTORS.has(p.code))
    .map((p) => ({
      afterStep,
      locator: {
        candidates: [{ strategy: "text" as const, text: p.pattern, weak: false }],
        fingerprint: { name: p.pattern, candidateCount: 1, framePath: [] as string[] },
        framePath: [] as string[],
      },
      pattern: p.pattern,
      outcome: p.code as OutcomeCode,
    }));

/** Only business outcomes are "known outcomes" for the caller; SESSION_EXPIRED and TIMEOUT stay hard failures. */
export const knownOutcomesFromProfile = (profile: AppProfile) =>
  profile.errorPatterns
    .filter((p) => OUTCOME_CODES.has(p.code) && BUSINESS_DETECTORS.has(p.code))
    .map((p) => ({
      code: p.code as OutcomeCode,
      description: OUTCOME_HELP[p.code] ?? p.pattern,
    }));

export const compileDiscoveredSteps = (input: {
  goal: string;
  steps: CapabilityStep[];
  profile: AppProfile;
  declaredOutputs?: OutputField[];
}): {
  steps: CapabilityStep[];
  outputs: OutputField[];
  success: Checkpoint;
  id: string;
  name: string;
} => {
  const collapsed = collapseRepeatedExtracts(input.steps);
  const preferred = input.declaredOutputs ?? [];
  const steps = collapsed.map((s) =>
    s.outputName ? { ...s, outputName: normalizeOutputName(s.outputName, preferred) } : s,
  );
  const outputs: OutputField[] = [];
  for (const s of steps) {
    if (s.action !== "extract" || !s.outputName) continue;
    if (outputs.some((o) => o.name === s.outputName)) continue;
    const declared = preferred.find((o) => o.name === s.outputName);
    const fromLocator = s.target?.fingerprint.name ?? s.target?.candidates[0]?.name;
    outputs.push(
      declared ?? {
        name: s.outputName,
        type: "string",
        sensitivity: "none",
        description: fromLocator ? `Extracted ${fromLocator}` : s.why,
      },
    );
  }
  const lastExtract = [...steps].reverse().find((s) => s.action === "extract" && s.target);
  const locName = lastExtract?.target?.fingerprint.name ?? lastExtract?.target?.candidates[0]?.name;
  const locRole = lastExtract?.target?.fingerprint.role ?? lastExtract?.target?.candidates[0]?.role;
  const success: Checkpoint = locName
    ? locRole
      ? { kind: "role_name", value: locName, role: locRole, name: locName }
      : { kind: "text", value: locName }
    : input.profile.entry;
  const slug = slugFromGoal(input.goal);
  return { steps, outputs, success, id: slug, name: slug.replace(/-/g, "_") };
};

export const sensitiveMaskPlan = (opts: {
  parameters?: Parameter[];
  values?: Record<string, string>;
  steps?: CapabilityStep[];
}): { chains: import("@cur/schema").LocatorChain[]; texts: string[] } => {
  const chains: import("@cur/schema").LocatorChain[] = [];
  const texts: string[] = [];
  for (const p of opts.parameters ?? []) {
    if (p.sensitivity === "none") continue;
    const v = opts.values?.[p.name];
    if (v) texts.push(v);
  }
  for (const s of opts.steps ?? []) {
    const input = s.input;
    if (input?.kind !== "paramRef" || !s.target) continue;
    const p = opts.parameters?.find((x) => x.name === input.param);
    if (p && p.sensitivity !== "none") chains.push(s.target);
  }
  return { chains, texts };
};
