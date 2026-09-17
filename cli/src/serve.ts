import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createBankApp } from "@cur/bank";
import {
  discover,
  FakeLlm,
  lookupBalanceScript,
  PolicyGuard,
  replay,
  seedLookupBalance,
  Session,
  WebAdapter,
  loopbackPolicy,
} from "@cur/engine";
import { Capability, type RunResult } from "@cur/schema";

type Live = {
  session: Session;
  adapter: WebAdapter;
  lastJpeg?: Buffer;
  intervention?: { why: string; step?: number };
};

const lives = new Map<string, Live>();

export const startServe = async (port: number) => {
  const bankPort = port + 1;
  serve({ fetch: createBankApp().fetch, hostname: "127.0.0.1", port: bankPort });
  const bankUrl = `http://127.0.0.1:${bankPort}/`;
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, bank: bankUrl, demoEnabled: process.env.DEMO_ENABLED !== "false" }));

  app.get("/api/capability", (c) => {
    return c.json(seedLookupBalance(bankPort));
  });

  app.post("/capabilities/:id/invoke", async (c) => {
    const id = c.req.param("id");
    if (id !== "lookup-savings-balance") return c.json({ error: "unknown capability" }, 404);
    const body = await c.req.json<{ memberId?: string; chaos?: string; confirmIrreversible?: boolean }>().catch(() => ({}));
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const adapter = new WebAdapter({
      policy,
      extraHeaders: body.chaos ? { "x-chaos": body.chaos } : undefined,
    });
    const session = new Session();
    try {
      const result = await replay({
        capability: seedLookupBalance(bankPort),
        values: { memberId: body.memberId ?? "12345" },
        adapter,
        policy,
        session,
        target: bankUrl,
        confirmIrreversible: body.confirmIrreversible,
      });
      return c.json(result);
    } finally {
      await adapter.close();
    }
  });

  app.post("/api/replay", async (c) => {
    const body = await c.req.json<{ memberId?: string; chaos?: string; confirmIrreversible?: boolean }>();
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const adapter = new WebAdapter({
      policy,
      extraHeaders: body.chaos ? { "x-chaos": body.chaos } : undefined,
    });
    const session = new Session();
    try {
      const result = await replay({
        capability: seedLookupBalance(bankPort),
        values: { memberId: body.memberId ?? "12345" },
        adapter,
        policy,
        session,
        target: bankUrl,
        confirmIrreversible: body.confirmIrreversible,
      });
      return c.json(result);
    } finally {
      await adapter.close();
    }
  });

  app.post("/api/discover", async (c) => {
    const body = await c.req.json<{ goal?: string; memberId?: string }>();
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const adapter = new WebAdapter({ policy });
    const session = new Session();
    try {
      const out = await discover({
        goal: body.goal ?? "look up the member and read their current savings balance",
        target: bankUrl,
        params: [
          { name: "memberId", type: "string", required: true, sensitivity: "pii", description: "Member ID" },
        ],
        values: { memberId: body.memberId ?? "12345" },
        adapter,
        llm: new FakeLlm(lookupBalanceScript()),
        policy,
        session,
        modelId: "fake",
      });
      return c.json({ capability: out.capability, events: out.events });
    } finally {
      await adapter.close();
    }
  });

  app.post("/api/session/start", async (c) => {
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const adapter = new WebAdapter({ policy });
    const session = new Session();
    await adapter.launch(bankUrl);
    lives.set(session.id, { session, adapter });
    return c.json({ sessionId: session.id, controlOwner: session.controlOwner });
  });

  app.post("/api/session/:id/escalate", async (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    live.session.setOwner("human");
    live.intervention = { why: "operator takeover requested" };
    live.lastJpeg = await live.adapter.screenshot();
    return c.json({ controlOwner: live.session.controlOwner, why: live.intervention.why });
  });

  app.post("/api/session/:id/click", async (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    if (live.session.controlOwner !== "human") return c.json({ error: "agent owns session" }, 409);
    const timer = live.session.releaseIfTimedOut();
    if (timer !== "ok") return c.json({ error: timer, controlOwner: live.session.controlOwner }, 409);
    const body = await c.req.json<{ nx: number; ny: number; viewport: { width: number; height: number } }>();
    await live.adapter.injectHumanInput("click", body);
    live.session.recordHuman();
    const locator = await live.adapter.elementAtPoint(body.nx, body.ny, body.viewport);
    live.lastJpeg = await live.adapter.screenshot();
    return c.json({ recorded: { nx: body.nx, ny: body.ny, viewport: body.viewport, locator } });
  });

  app.post("/api/session/:id/resume", async (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    live.session.setOwner("agent");
    live.intervention = undefined;
    return c.json({ controlOwner: live.session.controlOwner });
  });

  app.get("/api/session/:id/frame", async (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    live.lastJpeg = await live.adapter.screenshot();
    return c.body(new Uint8Array(live.lastJpeg), 200, { "content-type": "image/jpeg" });
  });

  app.get("/api/session/:id", (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    return c.json({
      sessionId: live.session.id,
      controlOwner: live.session.controlOwner,
      intervention: live.intervention,
    });
  });

  const consoleDir = join(process.cwd(), "apps/console/dist");
  app.get("*", async (c) => {
    if (!existsSync(consoleDir)) {
      return c.html(fallbackHtml(bankUrl));
    }
    const url = new URL(c.req.url);
    const file = url.pathname === "/" ? "/index.html" : url.pathname;
    const path = join(consoleDir, file);
    if (!existsSync(path)) return c.html(readFileSync(join(consoleDir, "index.html"), "utf8"));
    const ext = extname(path);
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    return c.body(readFileSync(path), 200, { "content-type": types[ext] ?? "application/octet-stream" });
  });

  serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
    console.log(`console http://127.0.0.1:${info.port}`);
    console.log(`bank    ${bankUrl}`);
  });
};

const fallbackHtml = (bank: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><title>Capability runtime</title>
<style>
  body { font-family: Georgia, serif; margin: 32px; max-width: 720px; color: #1b1b1b; }
  button { font: inherit; margin-right: 8px; }
  pre { background: #f4f1ea; padding: 12px; overflow: auto; }
  img { max-width: 100%; border: 1px solid #ccc; }
</style></head>
<body>
  <h1>Capability runtime</h1>
  <p>Mock core is bound to localhost only. This console talks to it through the engine.</p>
  <p><button id="replay">Replay member 12345</button>
     <button id="missing">Replay missing member</button>
     <button id="start">Start live session</button>
     <button id="take">Take over</button>
     <button id="resume">Resume agent</button></p>
  <img id="frame" alt="Live session frame"/>
  <pre id="out">bank ${bank}</pre>
<script>
const out = document.getElementById('out');
const frame = document.getElementById('frame');
let sessionId = null;
document.getElementById('replay').onclick = async () => {
  const r = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: '12345' }) });
  out.textContent = JSON.stringify(await r.json(), null, 2);
};
document.getElementById('missing').onclick = async () => {
  const r = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: '99999' }) });
  out.textContent = JSON.stringify(await r.json(), null, 2);
};
document.getElementById('start').onclick = async () => {
  const r = await fetch('/api/session/start', { method: 'POST' });
  const j = await r.json();
  sessionId = j.sessionId;
  out.textContent = JSON.stringify(j, null, 2);
  poll();
};
document.getElementById('take').onclick = async () => {
  const r = await fetch('/api/session/' + sessionId + '/escalate', { method: 'POST' });
  out.textContent = JSON.stringify(await r.json(), null, 2);
};
document.getElementById('resume').onclick = async () => {
  const r = await fetch('/api/session/' + sessionId + '/resume', { method: 'POST' });
  out.textContent = JSON.stringify(await r.json(), null, 2);
};
frame.onclick = async (e) => {
  if (!sessionId) return;
  const rect = frame.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  const r = await fetch('/api/session/' + sessionId + '/click', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nx, ny, viewport: { width: 1100, height: 720 } }) });
  out.textContent = JSON.stringify(await r.json(), null, 2);
};
async function poll() {
  if (!sessionId) return;
  frame.src = '/api/session/' + sessionId + '/frame?' + Date.now();
  setTimeout(poll, 700);
}
</script>
</body></html>`;
