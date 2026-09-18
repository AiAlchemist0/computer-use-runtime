import { useEffect, useMemo, useState } from "react";
import { blocked, FALLBACK_CASES, readable, type DemoCase } from "./cases";

type Health = {
  ok: boolean;
  mode: string;
  bank?: string;
};

type RunResult = Record<string, unknown>;

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [cases, setCases] = useState<DemoCase[]>(FALLBACK_CASES);
  const [memberId, setMemberId] = useState("12345");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [controlOwner, setControlOwner] = useState<string>("—");
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  const [pane, setPane] = useState<"teller" | "agent">("teller");

  const live = health?.mode === "local-live";

  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, mode: "unreachable" }));
    void fetch("/api/cases")
      .then((r) => r.json())
      .then((j: { cases?: DemoCase[] }) => {
        if (Array.isArray(j.cases) && j.cases.length) setCases(j.cases);
      })
      .catch(() => undefined);
  }, []);

  const active =
    cases.find((c) => c.id === memberId) ??
    ({
      id: memberId,
      ticket: "—",
      label: "Ad hoc",
      reason: "Typed member number",
      teller: "Number is not in this morning’s queue.",
      analyst: "Replay against the live core or recorded book.",
      outcome: "unknown",
    } satisfies DemoCase);

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => setFrameTick(Date.now()), 800);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const summary = useMemo(() => summarize(result, memberId), [result, memberId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `${res.status} ${res.statusText}`);
    return text ? (JSON.parse(text) as RunResult) : {};
  };

  const refreshOwner = async (id: string) => {
    const res = await fetch(`/api/session/${id}`);
    if (!res.ok) return;
    const j = (await res.json()) as { controlOwner?: string };
    setControlOwner(j.controlOwner ?? "agent");
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">MockCore · two-persona desk</p>
          <h1>Teller core and analyst desk</h1>
          <p className="lead">
            A branch operator looks members up in the legacy core. Finance records that path once
            and replays it without a model in the loop.
          </p>
        </div>
        <div className="pills">
          <span className={`pill ${live ? "live" : ""}`}>{health?.mode ?? "…"}</span>
          <span className={`pill ${controlOwner === "human" ? "human" : ""}`}>
            {sessionId ? `control ${controlOwner}` : "no live session"}
          </span>
          {health?.bank ? <span className="pill">bank on loopback</span> : null}
        </div>
      </header>

      <div className="stage">
        <section className="pane teller">
          <div className="head">
            <span>Bank user · teller / member servicing</span>
            <span>
              <button className="ghost" style={{ padding: "2px 8px" }} onClick={() => setPane("teller")}>
                Core
              </button>
              {live ? (
                <button className="ghost" style={{ padding: "2px 8px" }} onClick={() => setPane("agent")}>
                  Agent frame
                </button>
              ) : null}
            </span>
          </div>
          <div className="body">
            {pane === "agent" && sessionId ? (
              <img
                className="teller-frame"
                src={`/api/session/${sessionId}/frame?${frameTick}`}
                alt="Live agent view of the teller core"
                onClick={async (ev) => {
                  if (controlOwner !== "human") return;
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const nx = (ev.clientX - rect.left) / rect.width;
                  const ny = (ev.clientY - rect.top) / rect.height;
                  await run("click", async () => {
                    await post(`/api/session/${sessionId}/click`, {
                      nx,
                      ny,
                      viewport: { width: 1100, height: 720 },
                    });
                    await refreshOwner(sessionId);
                    setFrameTick(Date.now());
                  });
                }}
              />
            ) : live && health?.bank ? (
              <iframe className="teller-frame" title="Teller core" src={health.bank} />
            ) : (
              <TellerMock memberId={memberId} summary={summary} demo={active} />
            )}
            <p className="hint">
              {live
                ? "This is the hostile core: Member lookup, Member ID, Look up, then an iframe Account pane. Use it as a teller, or switch to Agent frame after Pause for teller."
                : "Hosted mode reconstructs the teller screen from the recorded outcome. Clone the repo for the live core."}
            </p>
          </div>
        </section>

        <section className="pane analyst">
          <div className="head">
            <span>Analyst / finance desk</span>
            <span>{busy ?? "ready"}</span>
          </div>
          <div className="body">
            <div className="group">
              <h3>Readable cases</h3>
              <div className="cases">
                {readable(cases).map((p) => (
                  <button
                    key={p.id}
                    className={memberId === p.id ? "primary" : "ghost"}
                    onClick={() => setMemberId(p.id)}
                    title={`${p.teller} ${p.analyst}`}
                  >
                    {p.label} · {p.id}
                  </button>
                ))}
              </div>
              <h3>Blocked / exception cases</h3>
              <div className="cases">
                {blocked(cases).map((p) => (
                  <button
                    key={p.id}
                    className={memberId === p.id ? "primary" : "ghost"}
                    onClick={() => setMemberId(p.id)}
                    title={`${p.teller} ${p.analyst}`}
                  >
                    {p.label} · {p.id}
                  </button>
                ))}
                <input
                  aria-label="Member under review"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                />
              </div>
              <p className="hint">
                {active.ticket} · {active.reason}. Teller: {active.teller} Analyst: {active.analyst}
              </p>
            </div>

            <div className="group">
              <h3>{live ? "Record once, then replay" : "Recorded replay"}</h3>
              <div className="actions">
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run("replay", async () => {
                      setResult(await post("/api/replay", { memberId }));
                    })
                  }
                >
                  Replay lookup
                </button>
                {live ? (
                  <>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run("discover", async () => {
                          setResult(await post("/api/discover", { memberId }));
                        })
                      }
                    >
                      Discover path
                    </button>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run("session", async () => {
                          const created = await post("/api/session/start");
                          const id = String(created.sessionId ?? "");
                          setSessionId(id);
                          setControlOwner(String(created.controlOwner ?? "agent"));
                          setPane("agent");
                        })
                      }
                    >
                      Open live session
                    </button>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run("handoff", async () => {
                          let id = sessionId;
                          if (!id) {
                            const created = await post("/api/session/start");
                            id = String(created.sessionId ?? "");
                            setSessionId(id);
                          }
                          setResult(await post(`/api/session/${id}/run`, { memberId }));
                          await refreshOwner(id);
                          setPane("agent");
                          setFrameTick(Date.now());
                        })
                      }
                    >
                      Pause for teller
                    </button>
                    <button
                      disabled={Boolean(busy) || !sessionId}
                      onClick={() =>
                        run("resume", async () => {
                          if (!sessionId) return;
                          const out = await post(`/api/session/${sessionId}/resume`);
                          setResult((out.result as RunResult) ?? out);
                          await refreshOwner(sessionId);
                          setFrameTick(Date.now());
                        })
                      }
                    >
                      Resume after human
                    </button>
                  </>
                ) : null}
              </div>
              <p className="hint">
                {live
                  ? "Pick a case, then replay. HITL types that member ID, pauses, and a human clicks Look up on the agent frame."
                  : "This hosted desk replays the approved capability against the recorded case book. It does not launch Chromium."}
              </p>
            </div>

            <div className="summary">
              <div className={`stat ${tone(summary.status)}`}>
                <b>Status</b>
                <span>{summary.status}</span>
              </div>
              <div className={`stat ${tone(summary.outcome)}`}>
                <b>Outcome</b>
                <span>{summary.outcome}</span>
              </div>
              <div className="stat">
                <b>Member</b>
                <span>{summary.member}</span>
              </div>
              <div className={`stat ${summary.balance !== "—" ? "ok" : ""}`}>
                <b>Savings</b>
                <span>{summary.balance}</span>
              </div>
            </div>
            {error ? (
              <p className="hint" style={{ color: "var(--bad)" }}>
                {error}
              </p>
            ) : null}
            <pre>
              {result
                ? JSON.stringify(result, null, 2)
                : "No run yet. Replay 12345 to post A. Nguyen’s savings to the desk."}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function TellerMock({
  memberId,
  summary,
  demo,
}: {
  memberId: string;
  summary: ReturnType<typeof summarize>;
  demo: DemoCase;
}) {
  const success = summary.balance !== "—" && /success/i.test(summary.status);
  const alert =
    /MEMBER_NOT_FOUND/i.test(summary.outcome)
      ? "No such member."
      : /PERMISSION_DENIED/i.test(summary.outcome)
        ? "Permission denied."
        : /ACCOUNT_FROZEN/i.test(summary.outcome)
          ? "Account is frozen."
          : /ESTATE_HOLD/i.test(summary.outcome)
            ? "Estate hold — supervisor required."
            : /VALIDATION/i.test(summary.outcome)
              ? "Member ID must be 5 digits."
              : "";

  return (
    <div className="teller-empty">
      <h2>{success ? `Member ${memberId}` : "Member lookup"}</h2>
      <p>Branch 014 · Operator TELLER-07 · {demo.ticket} · {demo.reason}</p>
      {success ? (
        <>
          <p>{demo.name ?? "Member"} · {demo.relationship ?? "Primary"}</p>
          {demo.flag ? <p>{demo.flag}</p> : null}
          <table className="grid">
            <tbody>
              <tr>
                <td>Savings balance</td>
                <td>{summary.balance}</td>
              </tr>
              <tr>
                <td>Account pane</td>
                <td>iframe · Savings {summary.balance}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <>
          <table className="grid">
            <tbody>
              <tr>
                <td>Member ID</td>
                <td>{memberId}</td>
              </tr>
              <tr>
                <td>Look up</td>
                <td>{alert || "Waiting for an analyst replay"}</td>
              </tr>
            </tbody>
          </table>
          <p>{demo.teller}</p>
        </>
      )}
    </div>
  );
}

function summarize(result: RunResult | null, fallbackMember: string) {
  if (!result) {
    return { status: "idle", outcome: "—", member: fallbackMember, balance: "—" };
  }
  const outputs = (result.outputs as Record<string, unknown> | undefined) ?? {};
  const inner = (result.result as Record<string, unknown> | undefined) ?? {};
  const innerOutputs = (inner.outputs as Record<string, unknown> | undefined) ?? {};
  const status = String(result.status ?? inner.status ?? (result.capability ? "compiled" : "unknown"));
  const outcome = String(result.outcome ?? inner.outcome ?? "—");
  const member = String(result.memberId ?? fallbackMember);
  const balance = String(outputs.savingsBalance ?? innerOutputs.savingsBalance ?? "—");
  return { status, outcome, member, balance };
}

function tone(value: string) {
  if (/success|ok|complete|compiled/i.test(value)) return "ok";
  if (/denied|fail|error|not_found|not-found/i.test(value)) return "bad";
  if (/human|pause|draft|escalate|business/i.test(value)) return "warn";
  return "";
}
