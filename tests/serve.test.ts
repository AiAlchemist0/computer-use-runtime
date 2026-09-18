import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServe } from "../cli/src/serve.js";

let serve: Awaited<ReturnType<typeof startServe>>;
let port = 0;

beforeAll(async () => {
  port = 8900 + Math.floor(Math.random() * 100);
  serve = await startServe(port);
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      /* still binding */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("console did not become healthy");
});

afterAll(async () => {
  await serve.close();
});

describe("local console invoke", () => {
  it("replays through POST /capabilities/:id/invoke", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/capabilities/lookup-savings-balance/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: "12345" }),
    });
    const j = (await r.json()) as { status?: string; outputs?: { savingsBalance?: string } };
    expect(r.status).toBe(200);
    expect(j.status).toBe("success");
    expect(j.outputs?.savingsBalance).toMatch(/1,842/);
  });

  it("hands the live session to a human over HTTP and resumes on the same page", async () => {
    const base = `http://127.0.0.1:${port}`;
    const post = async <T,>(path: string, body: unknown = {}) => {
      const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, json: (await r.json()) as T };
    };
    const start = await post<{ sessionId: string; controlOwner: string }>("/api/session/start");
    expect(start.json.controlOwner).toBe("agent");
    const id = start.json.sessionId;

    const paused = await post<{ status: string; controlOwner: string; intervention?: { reason: string; stepIndex?: number } }>(`/api/session/${id}/run`, { memberId: "12345" });
    expect(paused.json.status).toBe("escalated");
    expect(paused.json.controlOwner).toBe("human");
    expect(paused.json.intervention?.reason).toBe("PAUSE_AFTER_STEP");

    const ticket = (await (await fetch(`${base}/api/session/${id}`)).json()) as { controlOwner: string; intervention?: { capabilityId?: string } };
    expect(ticket.controlOwner).toBe("human");
    expect(ticket.intervention?.capabilityId).toBe("lookup-savings-balance");

    const blocked = await post<{ error: string }>(`/api/session/${id}/run`, { memberId: "12345" });
    expect(blocked.status).toBe(409);

    const click = await post<{ recorded: { locator?: { fingerprint?: { name?: string } } | null }; controlOwner: string }>(`/api/session/${id}/click`, {
      nx: 0.2417,
      ny: 0.2792,
      viewport: { width: 1100, height: 720 },
    });
    expect(click.status).toBe(200);
    expect(click.json.recorded.locator?.fingerprint?.name).toBe("Look up");

    const resumed = await post<{ controlOwner: string; result: { status: string; outputs?: { savingsBalance?: string } } }>(`/api/session/${id}/resume`);
    expect(resumed.json.controlOwner).toBe("agent");
    expect(resumed.json.result.status).toBe("success");
    expect(resumed.json.result.outputs?.savingsBalance).toMatch(/1,842/);
  });
});
