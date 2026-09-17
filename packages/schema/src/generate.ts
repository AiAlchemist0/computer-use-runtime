import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Capability } from "./capability.js";
import { RunResult } from "./run-result.js";
import { AppProfile } from "./app-profile.js";
import { TenantBinding } from "./tenant.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(root, "schemas");
mkdirSync(outDir, { recursive: true });

const write = (name: string, schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { target: "draft-07" });
  writeFileSync(join(outDir, name), `${JSON.stringify(json, null, 2)}\n`);
};

write("capability.v1.json", Capability);
write("run-result.v1.json", RunResult);
write("app-profile.v1.json", AppProfile);
write("tenant-binding.v1.json", TenantBinding);

console.log(`Wrote JSON Schema to ${outDir}`);
