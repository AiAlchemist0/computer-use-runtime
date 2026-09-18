import { z } from "zod";
import { Checkpoint, LocatorChain, OutcomeCode } from "./types.js";

export const InterstitialRule = z.object({
  id: z.string(),
  detect: LocatorChain,
  dismiss: z.object({
    action: z.enum(["click", "press"]),
    target: LocatorChain.optional(),
    key: z.string().optional(),
  }),
});
export type InterstitialRule = z.infer<typeof InterstitialRule>;

export const AppProfile = z.object({
  id: z.string(),
  vendorProduct: z.string(),
  entry: Checkpoint,
  sessionExpired: Checkpoint.optional(),
  interstitials: z.array(InterstitialRule).default([]),
  errorPatterns: z.array(
    z.object({
      code: z.union([OutcomeCode, z.literal("TIMEOUT")]),
      pattern: z.string(),
    }),
  ).default([]),
});
export type AppProfile = z.infer<typeof AppProfile>;
