import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replay, seedLookupBalance, Session } from "@cur/engine";
import { makeAdapter, startBank } from "./helpers.js";

let bank: Awaited<ReturnType<typeof startBank>>;

beforeAll(async () => {
  bank = await startBank();
});

afterAll(async () => {
  await bank.close();
});

describe("HITL session", () => {
  it("blocks agent actions while a human owns the session", async () => {
    const { adapter, policy, session } = makeAdapter(bank.port);
    await adapter.launch(bank.url);
    session.setOwner("human");
    expect(() => session.assertAgent()).toThrow(/human/);
    await expect(adapter.act({ action: "wait", value: "10" })).rejects.toThrow(/human/);
    const loc = await adapter.elementAtPoint(0.5, 0.5, { width: 1100, height: 720 });
    expect(loc === null || loc.candidates.length >= 0).toBe(true);
    await adapter.close();
    expect(seedLookupBalance(bank.port).status).toBe("approved");
    void policy;
  });

  it("times out an unanswered intervention and releases on idle", () => {
    const session = new Session({ unansweredMs: 20, idleMs: 20 });
    session.setOwner("human");
    expect(session.checkTimers(Date.now() + 50)).toBe("escalation_timed_out");
    session.setOwner("human");
    session.recordHuman();
    expect(session.checkTimers(Date.now() + 50)).toBe("human_idle");
    expect(session.releaseIfTimedOut(Date.now() + 50)).toBe("human_idle");
    expect(session.controlOwner).toBe("agent");
  });

  it("continues extract after a human Look up click on the same session", async () => {
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
      expect(session.controlOwner).toBe("human");
      const page = adapter.pageOrThrow();
      const button = page.getByRole("button", { name: "Look up" });
      const box = await button.boundingBox();
      expect(box).toBeTruthy();
      const viewport = page.viewportSize() ?? { width: 1100, height: 720 };
      const pointer = {
        nx: (box!.x + box!.width / 2) / viewport.width,
        ny: (box!.y + box!.height / 2) / viewport.height,
        viewport,
      };
      const locator = await adapter.elementAtPoint(pointer.nx, pointer.ny, pointer.viewport);
      expect(locator?.fingerprint.name).toBe("Look up");
      await adapter.injectHumanInput("click", pointer);
      session.recordHuman();
      session.setOwner("agent");
      const result = await replay({
        capability: cap,
        values: { memberId: "12345" },
        adapter,
        policy,
        session,
        target: bank.url,
        skipLaunch: true,
        resumeFrom: 1,
      });
      expect(result.status).toBe("success");
      expect(result.outputs?.savingsBalance).toMatch(/1,842/);
    } finally {
      await adapter.close();
    }
  });
});
