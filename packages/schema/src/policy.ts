import { z } from "zod";
import { ActionType } from "./types.js";

export const PolicySnapshot = z.object({
  allowHosts: z.array(z.string()).min(1),
  allowRoutes: z.array(z.string()).min(1),
  allowActions: z.array(ActionType).min(1),
});
export type PolicySnapshot = z.infer<typeof PolicySnapshot>;
