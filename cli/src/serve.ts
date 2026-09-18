import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { CASES, createBankApp } from "@cur/bank";
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
  memberId?: string;
  pausedAfter?: number;
};

const lives = new Map<string, Live>();

export const startServe = async (port: number) => {
  const bankPort = port + 1;
  const bankServer = serve({ fetch: createBankApp().fetch, hostname: "127.0.0.1", port: bankPort });
  const bankUrl = `http://127.0.0.1:${bankPort}/`;
  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({ ok: true, bank: bankUrl, demoEnabled: process.env.DEMO_ENABLED !== "false", mode: "local-live" }),
  );

  app.get("/api/capability", (c) => {
    return c.json(seedLookupBalance(bankPort));
  });

  app.get("/api/cases", (c) => c.json({ mode: "local-live", cases: CASES }));

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
    const session = new Session();
    const adapter = new WebAdapter({ policy, session });
    await adapter.launch(bankUrl);
    lives.set(session.id, { session, adapter });
    return c.json({ sessionId: session.id, controlOwner: session.controlOwner });
  });

  app.post("/api/session/:id/run", async (c) => {
    const live = lives.get(c.req.param("id"));
    if (!live) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ memberId?: string }>().catch(() => ({ memberId: "12345" }));
    live.memberId = body.memberId ?? "12345";
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const result = await replay({
      capability: seedLookupBalance(bankPort),
      values: { memberId: live.memberId },
      adapter: live.adapter,
      policy,
      session: live.session,
      target: bankUrl,
      skipLaunch: true,
      pauseAfterStep: 0,
    });
    live.pausedAfter = 0;
    live.intervention = { why: "paused after type for operator click", step: 0 };
    live.lastJpeg = await live.adapter.screenshot();
    return c.json({ ...result, controlOwner: live.session.controlOwner });
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
    const url = await live.adapter.url();
    const resumeFrom = url.includes("/member") ? 2 : 1;
    const policy = new PolicyGuard(loopbackPolicy(bankPort));
    const result = await replay({
      capability: seedLookupBalance(bankPort),
      values: { memberId: live.memberId ?? "12345" },
      adapter: live.adapter,
      policy,
      session: live.session,
      target: bankUrl,
      skipLaunch: true,
      resumeFrom,
    });
    live.lastJpeg = await live.adapter.screenshot().catch(() => live.lastJpeg);
    return c.json({ controlOwner: live.session.controlOwner, result });
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

  const consoleDir = join(dirname(fileURLToPath(import.meta.url)), "../../apps/console/dist");
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

  const consoleServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
    console.log(`console http://127.0.0.1:${info.port}`);
    console.log(`bank    ${bankUrl}`);
  });
  return {
    bankUrl,
    close: async () => {
      await new Promise<void>((done) => bankServer.close(() => done()));
      await new Promise<void>((done) => consoleServer.close(() => done()));
      for (const live of lives.values()) await live.adapter.close().catch(() => undefined);
      lives.clear();
    },
  };
};

const fallbackHtml = (bank: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MockCore · teller and analyst desk</title>
<style>
  :root { --desk:#0f1412; --desk-2:#18201c; --panel:#1c2621; --line:#2f3d36; --ink:#e8efe9; --muted:#9aada3; --brass:#d4b36a; --ok:#7dcea0; --paper:#f3ead6; --nav:#24362c; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--desk); }
  .top { display:flex; justify-content:space-between; gap:16px; padding:16px 22px; background:var(--desk-2); border-bottom:1px solid var(--line); }
  .eyebrow { margin:0 0 4px; color:var(--brass); font-size:11px; letter-spacing:.14em; text-transform:uppercase; }
  h1 { margin:0; font-size:22px; }
  .lead { margin:6px 0 0; color:var(--muted); font-size:13px; max-width:56ch; }
  .stage { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr); min-height:calc(100vh - 92px); }
  @media (max-width:980px) { .stage { grid-template-columns:1fr; } }
  .teller { background:#cfc4a8; color:#1c1914; }
  .analyst { background:var(--desk); border-left:1px solid var(--line); padding:16px; }
  .head { padding:12px 16px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; background:var(--nav); color:#f4efe4; display:flex; justify-content:space-between; }
  iframe, img { width:100%; min-height:420px; border:1px solid #8a7a55; background:var(--paper); display:none; }
  iframe.on, img.on { display:block; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 12px; }
  button, input { font:inherit; padding:8px 12px; border-radius:6px; border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  button.primary { background:#2a4638; border-color:#3d6a52; }
  pre { background:#101613; border:1px solid var(--line); padding:12px; overflow:auto; min-height:140px; font-size:12px; color:#c5d4cb; }
  .hint { color:var(--muted); font-size:12px; }
  .summary { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0; }
  .stat { background:var(--panel); border:1px solid var(--line); padding:10px 12px; border-radius:8px; }
  .stat b { display:block; font-size:11px; color:var(--muted); font-weight:500; }
</style></head>
<body>
  <header class="top">
    <div>
      <p class="eyebrow">MockCore · two-persona desk</p>
      <h1>Teller core and analyst desk</h1>
      <p class="lead">Left is the live teller window on loopback. Right is the finance desk that records once and replays without an LLM.</p>
    </div>
    <p class="hint">bank ${bank}</p>
  </header>
  <div class="stage">
    <section class="teller">
      <div class="head"><span>Bank user · teller / member servicing</span><span>
        <button id="showCore">Core</button>
        <button id="showAgent">Agent frame</button>
      </span></div>
      <iframe id="core" class="on" title="Teller core" src="${bank}"></iframe>
      <img id="frame" alt="Live agent view of the teller core"/>
    </section>
    <section class="analyst">
      <p class="hint" style="text-transform:uppercase;letter-spacing:.08em">Analyst / finance desk</p>
      <div class="actions" id="case-buttons">
        <button class="primary" data-id="12345">Known member · 12345</button>
        <button data-id="22222">Joint · 22222</button>
        <button data-id="33440">New · 33440</button>
        <button data-id="66778">Frozen · 66778</button>
        <button data-id="77889">Estate · 77889</button>
        <button data-id="88888">Restricted · 88888</button>
        <button data-id="99999">Not on file · 99999</button>
        <button data-id="1010">Bad ID · 1010</button>
        <input id="member" value="12345" aria-label="Member under review"/>
      </div>
      <div class="actions">
        <button class="primary" id="replay">Replay lookup</button>
        <button id="discover">Discover path</button>
        <button id="start">Open live session</button>
        <button id="handoff">Pause for teller</button>
        <button id="resume">Resume after human</button>
      </div>
      <p class="hint">Use the teller window as a branch operator. Pause for teller types the member ID, then click Look up on the agent frame and resume.</p>
      <div class="summary">
        <div class="stat"><b>Status</b><span id="st-status">idle</span></div>
        <div class="stat"><b>Outcome</b><span id="st-outcome">—</span></div>
        <div class="stat"><b>Member</b><span id="st-member">12345</span></div>
        <div class="stat"><b>Savings</b><span id="st-balance">—</span></div>
      </div>
      <pre id="out">Ready. Replay 12345 to post A. Nguyen’s savings.</pre>
    </section>
  </div>
<script>
const out = document.getElementById('out');
const frame = document.getElementById('frame');
const core = document.getElementById('core');
const member = document.getElementById('member');
let sessionId = null;
const show = (j, id) => {
  out.textContent = JSON.stringify(j, null, 2);
  const inner = j.result || j;
  document.getElementById('st-status').textContent = inner.status || j.status || 'unknown';
  document.getElementById('st-outcome').textContent = inner.outcome || j.outcome || '—';
  document.getElementById('st-member').textContent = id || member.value;
  document.getElementById('st-balance').textContent = inner.outputs?.savingsBalance || j.outputs?.savingsBalance || '—';
};
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
};
document.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { member.value = b.getAttribute('data-id'); });
document.getElementById('replay').onclick = async () => show(await post('/api/replay', { memberId: member.value }), member.value);
document.getElementById('discover').onclick = async () => show(await post('/api/discover', { memberId: member.value }), member.value);
document.getElementById('start').onclick = async () => {
  const j = await post('/api/session/start');
  sessionId = j.sessionId;
  show(j, member.value);
  showAgent();
  poll();
};
document.getElementById('handoff').onclick = async () => {
  if (!sessionId) {
    const started = await post('/api/session/start');
    sessionId = started.sessionId;
    poll();
  }
  show(await post('/api/session/' + sessionId + '/run', { memberId: member.value }), member.value);
  showAgent();
};
document.getElementById('resume').onclick = async () => show(await post('/api/session/' + sessionId + '/resume'), member.value);
document.getElementById('showCore').onclick = () => { core.className = 'on'; frame.className = ''; };
document.getElementById('showAgent').onclick = showAgent;
function showAgent() { core.className = ''; frame.className = 'on'; }
frame.onclick = async (e) => {
  if (!sessionId) return;
  const rect = frame.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  show(await post('/api/session/' + sessionId + '/click', { nx, ny, viewport: { width: 1100, height: 720 } }), member.value);
};
async function poll() {
  if (!sessionId) return;
  frame.src = '/api/session/' + sessionId + '/frame?' + Date.now();
  setTimeout(poll, 700);
}
</script>
</body></html>`;
