import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppProfile, Capability, RunResult, TenantBinding, z } from "@cur/schema";
import { buildDiscoverPrompt, normalizeParamRef, parseAriaRefs, seedLookupBalance } from "@cur/engine";

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

  it("parses aria snapshot refs for the compiler", () => {
    const refs = parseAriaRefs(`- textbox "Member ID" [ref=e3]\n- button "Look up" [ref=e5]`);
    expect(refs).toEqual([
      { role: "textbox", name: "Member ID", ref: "e3" },
      { role: "button", name: "Look up", ref: "e5" },
    ]);
  });

  it("matches committed JSON Schema files", () => {
    const names = [
      ["capability.v1.json", Capability],
      ["run-result.v1.json", RunResult],
      ["app-profile.v1.json", AppProfile],
      ["tenant-binding.v1.json", TenantBinding],
    ] as const;
    for (const [file, schema] of names) {
      const committed = JSON.parse(readFileSync(join(process.cwd(), "schemas", file), "utf8"));
      expect(z.toJSONSchema(schema, { target: "draft-07" })).toEqual(committed);
    }
  });

  it("normalizes member_id onto the declared memberId param", () => {
    expect(normalizeParamRef("member_id", [{ name: "memberId", type: "string", required: true, sensitivity: "pii", description: "id" }])).toBe(
      "memberId",
    );
  });

  it("lists declared params in the live discover prompt", () => {
    const prompt = buildDiscoverPrompt({
      goal: "look up",
      observation: "page",
      history: [],
      params: [{ name: "memberId", sensitivity: "pii" }],
    });
    expect(prompt).toContain("memberId");
    expect(prompt).toContain("pii");
  });
});
