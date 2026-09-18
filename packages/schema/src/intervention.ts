import { z } from "zod";

export const InterventionReason = z.enum([
  "STAGNANT",
  "REPEATED_ACTION",
  "BUDGET",
  "MODEL_ESCALATE",
  "IRREVERSIBLE_GATED",
  "REPLAY_UNRECOVERABLE",
  "PAUSE_AFTER_STEP",
]);
export type InterventionReason = z.infer<typeof InterventionReason>;

export const InterventionRequest = z.object({
  sessionId: z.string(),
  capabilityId: z.string().optional(),
  goal: z.string().optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  stepWhy: z.string().optional(),
  reason: InterventionReason,
  why: z.string(),
  url: z.string().optional(),
  screenshotRef: z.string().optional(),
  controlOwner: z.enum(["agent", "human"]),
  requestedAt: z.string(),
});
export type InterventionRequest = z.infer<typeof InterventionRequest>;
