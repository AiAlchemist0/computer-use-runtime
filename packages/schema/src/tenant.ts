import { z } from "zod";
import { LocatorChain } from "./types.js";

/** Schema + write-up only in v1. Not applied at runtime. */
export const TenantBinding = z.object({
  tenantId: z.string(),
  appProfile: z.string(),
  baseUrl: z.string(),
  locatorOverrides: z.record(z.string(), LocatorChain).default({}),
  notes: z.string().optional(),
});
export type TenantBinding = z.infer<typeof TenantBinding>;
