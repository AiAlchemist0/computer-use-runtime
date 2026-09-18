import { Hono } from "hono";
import { cors } from "hono/cors";
import { chatReplay } from "./chat.js";
import { CASES, HANDS, POLICY, isChaos, recordedChaos, recordedReplay } from "./cases.js";
import { TENANTS, canonicalize, checkPolicy, gateIrreversible, generatePlaywrightSpec, validateCapability } from "./logic.js";
import { Capability } from "@cur/schema";

export type Env = {
  SESSION: DurableObjectNamespace;
  DEMO_ENABLED?: string;
  TURNSTILE_SECRET_KEY?: string;
  DAILY_SESSION_BUDGET?: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  VENICE_API_KEY?: string;
  VENICE_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
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

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: [
      "https://deanshev.com",
      "https://www.deanshev.com",
      "https://interface.deanshev.com",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

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

app.get("/api/capability", async (c) => {
  const full = await readEvidenceJson(c.env, "capabilities/lookup-savings-balance.json");
  if (full) return c.json(full);
  return c.json({
    id: "lookup-savings-balance",
    status: "approved",
    description: "Look up a member and read their current savings balance",
  });
});

app.get("/api/cases", (c) => c.json({ mode: "recorded-fallback", cases: CASES }));

app.get("/api/integration", (c) =>
  c.json({
    mode: c.env.DEMO_ENABLED === "false" ? "kill-switch-recorded" : "recorded-fallback",
    capabilityId: "lookup-savings-balance",
    description: "Look up a member and read their current savings balance",
    hands: HANDS,
    policy: POLICY,
    cases: CASES,
    invoke: "POST /api/replay",
    chat: "POST /api/chat",
    liveLogic: ["POST /api/policy/check", "POST /api/policy/gate", "POST /api/capability/validate", "GET /api/capability/codegen", "POST /api/canonicalize"],
    recorded: ["GET /api/evidence/manifest.json", "GET /api/evidence/*", "GET /api/stability"],
    llm: Boolean(c.env.ZAI_API_KEY || c.env.VENICE_API_KEY || c.env.OPENAI_API_KEY),
    llmProvider: c.env.LLM_PROVIDER ?? (c.env.ZAI_API_KEY ? "zai" : undefined),
    llmModel: c.env.LLM_MODEL,
  }),
);

type ReplayBody = { memberId?: string; turnstileToken?: string; chaos?: string };

const gatedReplay = async (
  c: { env: Env; req: { url: string; json: <T>() => Promise<T>; header: (n: string) => string | undefined } },
  memberId?: string,
  token?: string,
  chaos?: string,
) => {
  if (c.env.DEMO_ENABLED === "false") {
    return { status: 503 as const, body: { error: "demo disabled", mode: "kill-switch-recorded" } };
  }
  const ok = await verifyTurnstile(token, c.env.TURNSTILE_SECRET_KEY, c.req.header("CF-Connecting-IP") ?? "");
  if (!ok) return { status: 403 as const, body: { error: "turnstile" } };
  if (isChaos(chaos)) return { status: 200 as const, body: recordedChaos(chaos, memberId) };
  return { status: 200 as const, body: recordedReplay(memberId) };
};

app.post("/api/replay", async (c) => {
  const body = await c.req.json<ReplayBody>().catch((): ReplayBody => ({ memberId: "12345" }));
  const out = await gatedReplay(c, body.memberId, body.turnstileToken, body.chaos);
  return c.json(out.body, out.status);
});

/** Live logic, no browser: the engine's PolicyGuard against a URL or action type. */
app.post("/api/policy/check", async (c) => {
  const body = await c.req.json<{ url?: string; action?: string }>().catch(() => ({}));
  return c.json(checkPolicy(body));
});

/** Live logic, no browser: Zod validation of a capability artifact. */
app.post("/api/capability/validate", async (c) => {
  const raw = await c.req.json().catch(() => null);
  return c.json(validateCapability(raw));
});

/** Live logic: the approval gate replay() applies before any irreversible act. */
app.post("/api/policy/gate", async (c) => {
  const body = await c.req.json<{ status?: "draft" | "approved"; confirmIrreversible?: boolean }>().catch(() => ({}));
  return c.json(gateIrreversible(body));
});

/** Pure transform: Playwright spec from the committed capability. */
app.get("/api/capability/codegen", async (c) => {
  const raw = await readEvidenceJson(c.env, "capabilities/lookup-savings-balance.json");
  const parsed = Capability.safeParse(raw);
  if (!parsed.success) return c.json({ error: "capability not available" }, 404);
  return c.text(generatePlaywrightSpec(parsed.data), 200, { "content-type": "text/plain; charset=utf-8" });
});

app.post("/api/canonicalize", async (c) => {
  const body = await c.req.json<{ url?: string; values?: Record<string, string> }>().catch(() => ({}));
  return c.json(canonicalize(body.url ?? "http://127.0.0.1:4177/member/12345", body.values ?? { memberId: "12345" }));
});

app.get("/api/tenants", (c) => c.json({ tenants: TENANTS, note: "TenantBinding is schema-only in v1; the variant replay is a design demonstration, not a recorded run." }));

const readEvidenceJson = async (env: Env, path: string): Promise<unknown> => {
  if (!env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new Request(`https://assets.local/evidence/${path}`));
  if (!res.ok) return null;
  return res.json();
};

/** Recorded evidence, served from the committed pack. */
app.get("/api/evidence/*", async (c) => {
  if (!c.env.ASSETS) return c.json({ error: "no assets" }, 404);
  const rest = c.req.path.replace(/^\/api\/evidence\//, "");
  const res = await c.env.ASSETS.fetch(new Request(`https://assets.local/evidence/${rest}`));
  if (!res.ok) return c.json({ error: "not found", path: rest }, 404);
  const headers = new Headers(res.headers);
  headers.set("cache-control", "public, max-age=300");
  return new Response(res.body, { status: 200, headers });
});

app.get("/api/stability", async (c) => {
  const data = await readEvidenceJson(c.env, "stability.json");
  if (!data) return c.json({ error: "stability not recorded" }, 404);
  return c.json(data);
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json<{ message?: string; memberId?: string; turnstileToken?: string }>().catch(() => ({ message: "" }));
  if (c.env.DEMO_ENABLED === "false") {
    return c.json({ error: "demo disabled", mode: "kill-switch-recorded" }, 503);
  }
  const ok = await verifyTurnstile(body.turnstileToken, c.env.TURNSTILE_SECRET_KEY, c.req.header("CF-Connecting-IP") ?? "");
  if (!ok) return c.json({ error: "turnstile" }, 403);
  const out = await chatReplay(c.env, body.message ?? "", body.memberId);
  return c.json(out);
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
