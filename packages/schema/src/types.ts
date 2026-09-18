import { z } from "zod";

export const Sensitivity = z.enum(["none", "pii", "secret"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const RiskClass = z.enum(["reversible", "irreversible"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const ActionType = z.enum([
  "navigate",
  "click",
  "type",
  "select",
  "press",
  "extract",
  "wait",
  "assert",
  "dismiss",
]);
export type ActionType = z.infer<typeof ActionType>;

export const OutcomeCode = z.enum([
  "MEMBER_NOT_FOUND",
  "PERMISSION_DENIED",
  "ACCOUNT_FROZEN",
  "ESTATE_HOLD",
  "VALIDATION_FAILED",
  "SESSION_EXPIRED",
  "UNEXPECTED_DIALOG",
]);
export type OutcomeCode = z.infer<typeof OutcomeCode>;

export const ChaosKind = z.enum([
  "none",
  "timeout",
  "dialog",
  "permission",
  "expired",
  "validation",
  "slow",
  "not_found",
]);
export type ChaosKind = z.infer<typeof ChaosKind>;

export const LocatorStrategy = z.enum([
  "role_name",
  "label",
  "text",
  "nth_role",
  "css",
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategy>;

export const LocatorCandidate = z.object({
  strategy: LocatorStrategy,
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  nth: z.number().int().nonnegative().optional(),
  css: z.string().optional(),
  weak: z.boolean().default(false),
});
export type LocatorCandidate = z.infer<typeof LocatorCandidate>;

export const LocatorFingerprint = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  nearbyText: z.string().optional(),
  candidateCount: z.number().int().nonnegative(),
  framePath: z.array(z.string()).default([]),
});
export type LocatorFingerprint = z.infer<typeof LocatorFingerprint>;

export const LocatorChain = z.object({
  candidates: z.array(LocatorCandidate).min(1),
  fingerprint: LocatorFingerprint,
  framePath: z.array(z.string()).default([]),
});
export type LocatorChain = z.infer<typeof LocatorChain>;

export const Checkpoint = z.object({
  kind: z.enum(["url", "role_name", "text", "title"]),
  value: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export const WaitFor = z.object({
  kind: z.enum(["url", "element", "text", "load"]),
  value: z.string().optional(),
  timeoutMs: z.number().int().positive().default(8000),
});
export type WaitFor = z.infer<typeof WaitFor>;

export const Parameter = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "enum"]),
  required: z.boolean().default(true),
  sensitivity: Sensitivity.default("none"),
  description: z.string(),
  enumValues: z.array(z.string()).optional(),
});
export type Parameter = z.infer<typeof Parameter>;

export const OutputField = z.object({
  name: z.string(),
  type: z.enum(["string", "number"]),
  sensitivity: Sensitivity.default("none"),
  description: z.string(),
});
export type OutputField = z.infer<typeof OutputField>;

export const StepInput = z.union([
  z.object({ kind: z.literal("value"), value: z.string() }),
  z.object({ kind: z.literal("paramRef"), param: z.string() }),
]);
export type StepInput = z.infer<typeof StepInput>;
