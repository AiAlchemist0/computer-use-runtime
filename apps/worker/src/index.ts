import { Hono } from "hono";

const seededSuccess = {
  schemaVersion: "1.0.0",
  runId: "evidence-replay-success",
  capabilityId: "lookup-savings-balance",
  status: "success",
  outputs: { savingsBalance: "$1,842.17" },
  events: [{ at: "2026-09-17T00:00:00.000Z", kind: "step_ok", why: "recorded from evidence/INDEX.md success replay" }],
  driftWarnings: [],
  evidence: { screenshots: [] },
};

const seededNotFound = {
  schemaVersion: "1.0.0",
  runId: "evidence-replay-not-found",
  capabilityId: "lookup-savings-balance",
  status: "business_outcome",
  outcome: "MEMBER_NOT_FOUND",
  events: [{ at: "2026-09-17T00:00:00.000Z", kind: "step_ok", why: "recorded from evidence/INDEX.md MEMBER_NOT_FOUND replay" }],
  driftWarnings: [],
  evidence: { screenshots: [] },
};

const seededDenied = {
  schemaVersion: "1.0.0",
  runId: "evidence-replay-permission",
  capabilityId: "lookup-savings-balance",
  status: "business_outcome",
  outcome: "PERMISSION_DENIED",
  events: [{ at: "2026-09-17T00:00:00.000Z", kind: "step_ok", why: "recorded from evidence/INDEX.md PERMISSION_DENIED replay" }],
  driftWarnings: [],
  evidence: { screenshots: [] },
};

export type Env = {
  SESSION: DurableObjectNamespace;
  DEMO_ENABLED?: string;
  TURNSTILE_SECRET_KEY?: string;
  DAILY_SESSION_BUDGET?: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
};

const todayKey = () => `budget:${new Date().toISOString().slice(0, 10)}`;

export class SessionCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const locked = (await this.state.storage.get<boolean>("locked")) ?? false;
    const used = (await this.state.storage.get<number>(todayKey())) ?? 0;
    const budget = Number(this.env.DAILY_SESSION_BUDGET ?? 40);

    if (url.pathname.endsWith("/status") && request.method === "GET") {
      return Response.json({ locked, used, budget, remaining: Math.max(0, budget - used) });
    }
    if (url.pathname.endsWith("/lock") && request.method === "POST") {
      if (used >= budget) return Response.json({ ok: false, reason: "budget" }, { status: 429 });
      if (locked) return Response.json({ ok: false, reason: "busy" }, { status: 429 });
      await this.state.storage.put("locked", true);
      await this.state.storage.put(todayKey(), used + 1);
      return Response.json({ ok: true, controlOwner: "agent" });
    }
    if (url.pathname.endsWith("/unlock") && request.method === "POST") {
      await this.state.storage.put("locked", false);
      return Response.json({ ok: true });
    }
    return Response.json({ locked, used, budget });
  }
}

const verifyTurnstile = async (token: string | undefined, secret: string | undefined, ip: string): Promise<boolean> => {
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
};

const recordedReplay = (memberId?: string) => {
  if (memberId === "88888") return seededDenied;
  if (memberId && memberId !== "12345") return seededNotFound;
  return seededSuccess;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const enabled = c.env.DEMO_ENABLED !== "false";
  const id = c.env.SESSION.idFromName("singleton");
  const stub = c.env.SESSION.get(id);
  const budget = await stub.fetch(new URL("/status", c.req.url)).then((r) => r.json()).catch(() => ({}));
  return c.json({
    ok: true,
    demoEnabled: enabled,
    mode: enabled ? "recorded-fallback" : "kill-switch-recorded",
    budget,
  });
});

app.get("/api/capability", (c) =>
  c.json({
    id: "lookup-savings-balance",
    status: "approved",
    description: "Look up a member and read their current savings balance",
  }),
);

const gatedReplay = async (c: { env: Env; req: { url: string; json: <T>() => Promise<T>; header: (n: string) => string | undefined } }, memberId?: string, token?: string) => {
  if (c.env.DEMO_ENABLED === "false") {
    return { status: 503 as const, body: { error: "demo disabled", mode: "kill-switch-recorded" } };
  }
  const ok = await verifyTurnstile(token, c.env.TURNSTILE_SECRET_KEY, c.req.header("CF-Connecting-IP") ?? "");
  if (!ok) return { status: 403 as const, body: { error: "turnstile" } };
  const id = c.env.SESSION.idFromName("singleton");
  const stub = c.env.SESSION.get(id);
  const locked = await stub.fetch(new URL("/lock", c.req.url), { method: "POST" });
  if (locked.status === 429) {
    const reason = await locked.json().catch(() => ({ reason: "busy" }));
    return { status: 429 as const, body: reason };
  }
  try {
    return { status: 200 as const, body: recordedReplay(memberId) };
  } finally {
    await stub.fetch(new URL("/unlock", c.req.url), { method: "POST" });
  }
};

app.post("/api/replay", async (c) => {
  const body = await c.req.json<{ memberId?: string; turnstileToken?: string }>().catch(() => ({ memberId: "12345" }));
  const out = await gatedReplay(c, body.memberId, body.turnstileToken);
  return c.json(out.body, out.status);
});

app.post("/capabilities/:id/invoke", async (c) => {
  if (c.req.param("id") !== "lookup-savings-balance") return c.json({ error: "unknown capability" }, 404);
  const body = await c.req.json<{ memberId?: string; turnstileToken?: string }>().catch(() => ({ memberId: "12345" }));
  const out = await gatedReplay(c, body.memberId, body.turnstileToken);
  return c.json(out.body, out.status);
});

app.post("/api/discover", (c) =>
  c.json(
    {
      error:
        "Live discovery is rate-limited on the hosted demo. Replay the approved capability, or run pnpm discover locally.",
    },
    429,
  ),
);

app.get("*", async (c) => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) return res;
  }
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Capability runtime</title>
<style>body{font-family:Georgia,serif;margin:32px;max-width:720px}pre{background:#f4f1ea;padding:12px}</style></head>
<body>
<h1>Capability runtime</h1>
<p>Hosted default is replay of the approved lookup. The mock bank never leaves localhost.</p>
<p><button id="ok">Replay 12345</button> <button id="miss">Replay 99999</button></p>
<pre id="out">recorded fallback</pre>
<script>
const out = document.getElementById('out');
document.getElementById('ok').onclick = async () => {
  out.textContent = JSON.stringify(await (await fetch('/api/replay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({memberId:'12345'})})).json(),null,2);
};
document.getElementById('miss').onclick = async () => {
  out.textContent = JSON.stringify(await (await fetch('/api/replay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({memberId:'99999'})})).json(),null,2);
};
</script>
</body></html>`);
});

export default {
  fetch: app.fetch,
};
