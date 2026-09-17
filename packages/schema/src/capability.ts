import { z } from "zod";
import { PolicySnapshot } from "./policy.js";
import {
  ActionType,
  Checkpoint,
  LocatorChain,
  OutcomeCode,
  OutputField,
  Parameter,
  RiskClass,
  StepInput,
  WaitFor,
} from "./types.js";

export const OutcomeDetector = z.object({
  afterStep: z.number().int().nonnegative(),
  locator: LocatorChain,
  pattern: z.string(),
  outcome: OutcomeCode,
});
export type OutcomeDetector = z.infer<typeof OutcomeDetector>;

export const KnownOutcome = z.object({
  code: OutcomeCode,
  description: z.string(),
});
export type KnownOutcome = z.infer<typeof KnownOutcome>;

export const CapabilityStep = z.object({
  id: z.string(),
  action: ActionType,
  target: LocatorChain.optional(),
  input: StepInput.optional(),
  outputName: z.string().optional(),
  waitFor: WaitFor.optional(),
  checkpoint: Checkpoint.optional(),
  riskClass: RiskClass.default("reversible"),
  why: z.string(),
});
export type CapabilityStep = z.infer<typeof CapabilityStep>;

export const Provenance = z.object({
  discoveryRunId: z.string(),
  modelId: z.string(),
  createdAt: z.string(),
  sourceHash: z.string(),
});
export type Provenance = z.infer<typeof Provenance>;

export const Capability = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  appProfile: z.string(),
  provenance: Provenance,
  riskClass: RiskClass,
  policy: PolicySnapshot,
  parameters: z.array(Parameter),
  outputs: z.array(OutputField),
  entry: Checkpoint,
  steps: z.array(CapabilityStep).min(1),
  outcomeDetectors: z.array(OutcomeDetector).default([]),
  success: Checkpoint,
  knownOutcomes: z.array(KnownOutcome).default([]),
});
export type Capability = z.infer<typeof Capability>;
