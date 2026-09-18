import { randomUUID } from "node:crypto";
import type { Capability, DriftWarning, RunEvent, RunResult } from "@cur/schema";
import type { WebAdapter } from "./web-adapter.js";
import { PolicyDenied, PolicyGuard } from "./policy.js";
import type { Session } from "./session.js";
import { mockBankProfile, resolveProfile } from "./profiles.js";

export type ReplayInput = {
  capability: Capability;
  values: Record<string, string>;
  adapter: WebAdapter;
  policy: PolicyGuard;
  session: Session;
  target: string;
  confirmIrreversible?: boolean;
  pauseAfterStep?: number;
  resumeFrom?: number;
  skipLaunch?: boolean;
};

export const replay = async (input: ReplayInput): Promise<RunResult> => {
  const { capability, adapter, policy, session, values } = input;
  const events: RunEvent[] = [];
  const driftWarnings: DriftWarning[] = [];
  const outputs: Record<string, string> = {};
  const runId = randomUUID();
  adapter.bindSession(session);

  if (capability.riskClass === "irreversible" || capability.steps.some((s) => s.riskClass === "irreversible")) {
    if (capability.status !== "approved" || !input.confirmIrreversible) {
      session.setOwner("human");
      return {
        schemaVersion: "1.0.0",
        runId,
        capabilityId: capability.id,
        status: "escalated",
        failure: {
          stepIndex: 0,
          expected: "approved + confirmIrreversible",
          observed: "irreversible step gated",
          code: "IRREVERSIBLE_GATED",
          evidenceRefs: [],
        },
        events: [
          {
            at: now(),
            kind: "escalation_requested",
            why: "irreversible step requires approved status and confirmIrreversible",
          },
        ],
        driftWarnings: [],
        evidence: { screenshots: [] },
      };
    }
  }

  if (!input.skipLaunch || !adapter.isOpen()) {
    await adapter.launch(input.target);
    policy.assertNavigate(input.target);
    if (!(await adapter.assertCheckpoint(capability.entry))) {
      return fail(runId, capability.id, 0, "entry checkpoint", "entry screen not visible", "CHECKPOINT_FAILED", events);
    }
  } else {
    policy.assertNavigate(await adapter.url());
  }

  const profile = resolveProfile(capability.appProfile) ?? mockBankProfile();
  const start = input.resumeFrom ?? 0;
  const dismissed = new Set<string>();

  for (let i = start; i < capability.steps.length; i++) {
    session.assertAgent();
    const step = capability.steps[i]!;
    try {
      policy.assertAction(step.action);
      if (step.action === "navigate" && step.input?.kind === "value") policy.assertNavigate(step.input.value);

      for (const rule of profile.interstitials) {
        if (dismissed.has(rule.id)) continue;
        const found = await adapter.resolve(rule.detect);
        if (found.count === 1 && rule.dismiss.target) {
          await adapter.act({ action: "dismiss", target: rule.dismiss.target });
          dismissed.add(rule.id);
          events.push({ at: now(), kind: "recovered", stepIndex: i, why: `dismissed ${rule.id}` });
        }
      }

      const timeoutPattern = profile.errorPatterns.find((p) => p.code === "TIMEOUT")?.pattern ?? "The core is not responding";
      if (await adapter.assertCheckpoint({ kind: "text", value: timeoutPattern })) {
        return fail(runId, capability.id, i, "lookup response", timeoutPattern, "TIMEOUT", events, driftWarnings);
      }

      if (profile.sessionExpired && (await adapter.assertCheckpoint(profile.sessionExpired))) {
        return fail(runId, capability.id, i, "active session", profile.sessionExpired.value, "UNEXPECTED_STATE", events, driftWarnings);
      }

      const value =
        step.input?.kind === "paramRef"
          ? values[step.input.param]
          : step.input?.kind === "value"
            ? step.input.value
            : undefined;

      if (step.target) {
        const resolved = await adapter.resolve(step.target);
        if (resolved.count !== step.target.fingerprint.candidateCount) {
          driftWarnings.push({
            stepIndex: i,
            expected: `count=${step.target.fingerprint.candidateCount}`,
            observed: `count=${resolved.count}`,
          });
          events.push({ at: now(), kind: "drift_warning", stepIndex: i, why: "locator fingerprint changed" });
        }
      }

      const started = Date.now();
      try {
        if (step.action === "extract" && step.target && step.outputName) {
          const extracted = await adapter.extract(step.target);
          outputs[step.outputName] = extracted.text;
        } else {
          await adapter.act({ action: step.action, target: step.target, value });
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "TARGET_NOT_FOUND" && step.action === "click" && i < capability.steps.length - 1) {
          events.push({ at: now(), kind: "recovered", stepIndex: i, why: "click already satisfied by human" });
        } else {
          throw err;
        }
      }

      if (step.waitFor) {
        try {
          await adapter.waitFor(step.waitFor.kind, step.waitFor.value, step.waitFor.timeoutMs);
        } catch {
          return fail(runId, capability.id, i, step.waitFor.value ?? step.waitFor.kind, "wait timed out", "TIMEOUT", events, driftWarnings);
        }
      }
      if (Date.now() - started > 1500) {
        events.push({ at: now(), kind: "recovered", stepIndex: i, why: "slow load waited out" });
      }

      for (const det of capability.outcomeDetectors.filter((d) => d.afterStep === i)) {
        const hit = await adapter.assertCheckpoint({ kind: "text", value: det.pattern });
        if (hit) {
          return {
            schemaVersion: "1.0.0",
            runId,
            capabilityId: capability.id,
            status: "business_outcome",
            outcome: det.outcome,
            events: [...events, { at: now(), kind: "step_ok", stepIndex: i, why: step.why }],
            driftWarnings,
            evidence: { screenshots: [] },
          };
        }
      }

      events.push({ at: now(), kind: "step_ok", stepIndex: i, why: step.why });
      if (input.pauseAfterStep === i) {
        session.setOwner("human");
        events.push({ at: now(), kind: "escalation_requested", why: "pauseAfterStep — operator takeover" });
        return {
          schemaVersion: "1.0.0",
          runId,
          capabilityId: capability.id,
          status: "escalated",
          events,
          driftWarnings,
          evidence: { screenshots: [] },
        };
      }
    } catch (err) {
      if (err instanceof PolicyDenied) {
        return fail(runId, capability.id, i, "policy allow", err.reason, "POLICY_DENIED", events, driftWarnings);
      }
      const code = (err as { code?: string }).code;
      if (code === "AMBIGUOUS_TARGET") {
        return fail(runId, capability.id, i, "unique target", "multiple matches", "AMBIGUOUS_TARGET", events, driftWarnings);
      }
      if (code === "TARGET_NOT_FOUND") {
        return fail(runId, capability.id, i, "target present", "not found", "TARGET_NOT_FOUND", events, driftWarnings);
      }
      throw err;
    }
  }

  const ok = await adapter.assertCheckpoint(capability.success);
  if (!ok) {
    return fail(runId, capability.id, capability.steps.length - 1, capability.success.value, "success checkpoint missing", "CHECKPOINT_FAILED", events, driftWarnings);
  }

  return {
    schemaVersion: "1.0.0",
    runId,
    capabilityId: capability.id,
    status: "success",
    outputs,
    events,
    driftWarnings,
    evidence: { screenshots: [] },
  };
};

const fail = (
  runId: string,
  capabilityId: string,
  stepIndex: number,
  expected: string,
  observed: string,
  code: NonNullable<RunResult["failure"]>["code"],
  events: RunEvent[],
  driftWarnings: DriftWarning[] = [],
): RunResult => ({
  schemaVersion: "1.0.0",
  runId,
  capabilityId,
  status: "failed",
  failure: { stepIndex, expected, observed, code, evidenceRefs: [] },
  events,
  driftWarnings,
  evidence: { screenshots: [] },
});

const now = () => new Date().toISOString();
