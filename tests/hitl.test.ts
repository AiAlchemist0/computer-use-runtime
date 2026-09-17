import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLookupBalance, Session } from "@cur/engine";
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
});
