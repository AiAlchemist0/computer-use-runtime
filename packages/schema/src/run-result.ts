import { z } from "zod";
import { RunEvent } from "./events.js";
import { InterventionRequest } from "./intervention.js";
import { OutcomeCode } from "./types.js";

export const DriftWarning = z.object({
  stepIndex: z.number().int().nonnegative(),
  expected: z.string(),
  observed: z.string(),
});
export type DriftWarning = z.infer<typeof DriftWarning>;

export const RunFailure = z.object({
  stepIndex: z.number().int().nonnegative(),
  expected: z.string(),
  observed: z.string(),
  code: z.enum([
    "AMBIGUOUS_TARGET",
    "TARGET_NOT_FOUND",
    "CHECKPOINT_FAILED",
    "TIMEOUT",
    "UNEXPECTED_STATE",
    "POLICY_DENIED",
    "IRREVERSIBLE_GATED",
  ]),
  evidenceRefs: z.array(z.string()).default([]),
});
export type RunFailure = z.infer<typeof RunFailure>;

export const RunResult = z.object({
  schemaVersion: z.literal("1.0.0"),
  runId: z.string(),
  capabilityId: z.string().optional(),
  status: z.enum(["success", "business_outcome", "escalated", "failed"]),
  outputs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  outcome: OutcomeCode.optional(),
  failure: RunFailure.optional(),
  events: z.array(RunEvent).default([]),
  driftWarnings: z.array(DriftWarning).default([]),
  intervention: InterventionRequest.optional(),
  evidence: z.object({
    screenshots: z.array(z.string()).default([]),
    trace: z.string().optional(),
  }),
});
export type RunResult = z.infer<typeof RunResult>;
