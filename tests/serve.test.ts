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
});
