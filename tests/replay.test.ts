import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discover, FakeLlm, lookupBalanceScript, replay, seedLookupBalance } from "@cur/engine";
import { makeAdapter, startBank } from "./helpers.js";

let bank: Awaited<ReturnType<typeof startBank>>;

beforeAll(async () => {
  bank = await startBank();
});

afterAll(async () => {
  await bank.close();
});

describe("replay + discover", () => {
  it("discovers with the fake LLM and records why", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      const out = await discover({
        goal: "look up the member and read their current savings balance",
        target: bank.url,
        params: [{ name: "memberId", type: "string", required: true, sensitivity: "pii", description: "id" }],
        values: { memberId: "12345" },
        adapter,
        llm: new FakeLlm(lookupBalanceScript()),
        policy,
        session,
        modelId: "fake",
      });
      expect(out.events.every((e) => e.why.length > 0)).toBe(true);
      expect(out.capability.steps.length).toBeGreaterThan(1);
      expect(out.capability.status).toBe("approved");
      expect(JSON.stringify(out.capability)).not.toContain("12345");
      expect(out.capability.steps.some((s) => s.input?.kind === "paramRef" && s.input.param === "memberId")).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it("rejects an unknown paramRef during discover", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      await expect(
        discover({
          goal: "look up the member",
          target: bank.url,
          params: [{ name: "memberId", type: "string", required: true, sensitivity: "pii", description: "id" }],
          values: { memberId: "12345" },
          adapter,
          llm: new FakeLlm([
            {
              name: "type",
              arguments: { role: "textbox", name: "Member ID", paramRef: "ssn", why: "wrong param" },
            },
          ]),
          policy,
          session,
          modelId: "fake",
        }),
      ).rejects.toMatchObject({ code: "UNKNOWN_PARAM_REF" });
    } finally {
      await adapter.close();
    }
  });

  it("replays the happy path and returns the balance", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("success");
      expect(result.outputs?.savingsBalance).toMatch(/1,842/);
    } finally {
      await adapter.close();
    }
  });

  it("returns MEMBER_NOT_FOUND as a business outcome", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "99999" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("business_outcome");
      expect(result.outcome).toBe("MEMBER_NOT_FOUND");
    } finally {
      await adapter.close();
    }
  });

  it("returns PERMISSION_DENIED as a business outcome", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "88888" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("business_outcome");
      expect(result.outcome).toBe("PERMISSION_DENIED");
    } finally {
      await adapter.close();
    }
  });

  it("returns VALIDATION_FAILED for a short id", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("business_outcome");
      expect(result.outcome).toBe("VALIDATION_FAILED");
    } finally {
      await adapter.close();
    }
  });

  it("recovers from a slow load", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port, "slow");
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("success");
      expect(result.events.some((e) => e.kind === "recovered")).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it("fails clearly on session expiry", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port, "expired");
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("failed");
      expect(result.failure?.code).toBe("UNEXPECTED_STATE");
    } finally {
      await adapter.close();
    }
  });

  it("fails with TIMEOUT when the core stops responding", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port, "timeout");
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("failed");
      expect(result.failure?.code).toBe("TIMEOUT");
    } finally {
      await adapter.close();
    }
  });

  it("fails with AMBIGUOUS_TARGET when a locator matches more than one control", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    cap.steps = [
      {
        id: "s1",
        action: "click",
        target: {
          candidates: [{ strategy: "text", text: "Member", weak: false }],
          fingerprint: { name: "Member", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        waitFor: { kind: "load", timeoutMs: 4000 },
        riskClass: "reversible",
        why: "Ambiguous click used to prove uniqueness enforcement",
      },
    ];
    try {
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("failed");
      expect(result.failure?.code).toBe("AMBIGUOUS_TARGET");
    } finally {
      await adapter.close();
    }
  });

  it("escalates irreversible steps without approval", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    cap.riskClass = "irreversible";
    cap.status = "draft";
    try {
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("escalated");
      expect(result.failure?.code).toBe("IRREVERSIBLE_GATED");
    } finally {
      await adapter.close();
    }
  });

  it("runs an approved irreversible confirm when confirmIrreversible is set", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    cap.riskClass = "irreversible";
    cap.steps.push({
      id: "s4",
      action: "click",
      target: {
        candidates: [{ strategy: "role_name", role: "button", name: "Open sub-account", weak: false }],
        fingerprint: { role: "button", name: "Open sub-account", candidateCount: 1, framePath: [] },
        framePath: [],
      },
      waitFor: { kind: "text", value: "Confirm sub-account", timeoutMs: 4000 },
      riskClass: "irreversible",
      why: "Open the confirmation screen",
    });
    cap.success = { kind: "text", value: "Confirm sub-account" };
    try {
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
        confirmIrreversible: true,
      });
      expect(result.status).toBe("success");
    } finally {
      await adapter.close();
    }
  });

  it("returns TARGET_NOT_FOUND when the locator matches nothing", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    cap.steps = [
      {
        id: "s1",
        action: "click",
        target: {
          candidates: [{ strategy: "role_name", role: "button", name: "No such control", weak: false }],
          fingerprint: { role: "button", name: "No such control", candidateCount: 1, framePath: [] },
          framePath: [],
        },
        waitFor: { kind: "load", timeoutMs: 2000 },
        riskClass: "reversible",
        why: "Prove missing target fails closed",
      },
    ];
    try {
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("failed");
      expect(result.failure?.code).toBe("TARGET_NOT_FOUND");
    } finally {
      await adapter.close();
    }
  });

  it("denies navigation off the route allowlist", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    cap.steps = [
      {
        id: "s1",
        action: "navigate",
        input: { kind: "value", value: `http://127.0.0.1:${bank.port}/evil` },
        waitFor: { kind: "load", timeoutMs: 2000 },
        riskClass: "reversible",
        why: "Prove policy abort",
      },
    ];
    try {
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("failed");
      expect(result.failure?.code).toBe("POLICY_DENIED");
    } finally {
      await adapter.close();
    }
  });

  it("pauses after type and resumes extract after a human Look up click", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    const cap = seedLookupBalance(bank.port);
    try {
      const paused = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
        pauseAfterStep: 0,
      });
      expect(paused.status).toBe("escalated");
      session.setOwner("human");
      const page = adapter.pageOrThrow();
      const box = await page.getByRole("button", { name: "Look up" }).boundingBox();
      expect(box).toBeTruthy();
      const viewport = page.viewportSize() ?? { width: 1100, height: 720 };
      await adapter.injectHumanInput("click", {
        nx: (box!.x + box!.width / 2) / viewport.width,
        ny: (box!.y + box!.height / 2) / viewport.height,
        viewport,
      });
      session.recordHuman();
      session.setOwner("agent");
      const resumed = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
        skipLaunch: true,
        resumeFrom: 1,
      });
      expect(resumed.status).toBe("success");
      expect(resumed.outputs?.savingsBalance).toMatch(/1,842/);
    } finally {
      await adapter.close();
    }
  });

  it("dismisses an unexpected dialog then continues", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port, "dialog");
    try {
      const result = await replay({
        capability: seedLookupBalance(bank.port),
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
      });
      expect(result.status).toBe("success");
      expect(result.events.some((e) => e.kind === "recovered")).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});
