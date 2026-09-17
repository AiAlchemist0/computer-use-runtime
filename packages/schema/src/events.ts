import { z } from "zod";

export const RunEvent = z.object({
  at: z.string(),
  kind: z.enum([
    "step_ok",
    "recovered",
    "drift_warning",
    "escalation_requested",
    "escalation_timed_out",
    "human_action",
    "human_resume",
    "policy_denied",
  ]),
  stepIndex: z.number().int().nonnegative().optional(),
  why: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;
