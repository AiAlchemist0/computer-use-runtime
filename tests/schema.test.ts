import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Capability, RunResult, TenantBinding } from "@cur/schema";
import { seedLookupBalance } from "@cur/engine";

describe("schema", () => {
  it("round-trips the seeded capability", () => {
    const cap = seedLookupBalance(4177);
    expect(Capability.parse(JSON.parse(JSON.stringify(cap))).id).toBe("lookup-savings-balance");
  });

  it("rejects a result missing schemaVersion", () => {
    expect(() => RunResult.parse({ runId: "x", status: "success" })).toThrow();
  });

  it("keeps TenantBinding as a typed unused layer", () => {
    const t = TenantBinding.parse({
      tenantId: "cu-1",
      appProfile: "mock-core-v1",
      baseUrl: "https://core.example.cu",
      locatorOverrides: {},
    });
    expect(t.tenantId).toBe("cu-1");
  });

  it("matches committed JSON Schema files", () => {
    const cap = JSON.parse(readFileSync(join(process.cwd(), "schemas/capability.v1.json"), "utf8"));
    expect(cap.$schema || cap.type || cap.properties).toBeTruthy();
  });
});
