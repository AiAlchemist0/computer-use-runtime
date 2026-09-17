import { useEffect, useState } from "react";

type Result = Record<string, unknown>;

export const App = () => {
  const [out, setOut] = useState("Default path is replay of the approved lookup_savings_balance capability.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [owner, setOwner] = useState("none");
  const [memberId, setMemberId] = useState("12345");
  const [frame, setFrame] = useState("");
  const [mode, setMode] = useState("local-live");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j: { mode?: string }) => {
        if (j.mode) setMode(j.mode);
      })
      .catch(() => undefined);
  }, []);

  const post = async (url: string, body?: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await r.json()) as Result;
    setOut(JSON.stringify(j, null, 2));
    return j;
  };

  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(() => {
      setFrame(`/api/session/${sessionId}/frame?${Date.now()}`);
    }, 700);
    return () => clearInterval(t);
  }, [sessionId]);

  return (
    <main>
      <h1>Capability runtime</h1>
      <p className="meta">
        The model discovers. The artifact is the contract. Replay has no model in the loop.
      </p>
      <p>
        <span className="pill">mode {mode}</span>
        <span className="pill">owner {owner}</span>
        <span className="pill">session {sessionId ?? "—"}</span>
      </p>
      <div className="row">
        <input value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Member ID" />
        <button
          onClick={() => post("/api/replay", { memberId })}
        >
          Replay
        </button>
        <button onClick={() => post("/api/replay", { memberId: "99999" })}>Replay not-found</button>
        <button onClick={() => post("/api/replay", { memberId: "88888" })}>Replay permission</button>
        <button onClick={() => post("/api/replay", { memberId, chaos: "slow" })}>Replay slow</button>
        <button onClick={() => post("/api/discover", { memberId, goal: "look up savings balance" })}>
          Discover (rate-limited)
        </button>
      </div>
      <div className="row">
        <button
          onClick={async () => {
            const j = await post("/api/session/start");
            setSessionId(String(j.sessionId ?? ""));
            setOwner(String(j.controlOwner ?? "agent"));
          }}
        >
          Start live session
        </button>
        <button
          onClick={async () => {
            if (!sessionId) return;
            const j = await post(`/api/session/${sessionId}/escalate`);
            setOwner(String(j.controlOwner ?? "human"));
          }}
        >
          Take over
        </button>
        <button
          onClick={async () => {
            if (!sessionId) return;
            const j = await post(`/api/session/${sessionId}/resume`);
            setOwner(String(j.controlOwner ?? "agent"));
          }}
        >
          Resume agent
        </button>
      </div>
      <img
        className="frame"
        src={frame}
        alt="Live session"
        onClick={async (e) => {
          if (!sessionId) return;
          const rect = (e.target as HTMLImageElement).getBoundingClientRect();
          const nx = (e.clientX - rect.left) / rect.width;
          const ny = (e.clientY - rect.top) / rect.height;
          await post(`/api/session/${sessionId}/click`, {
            nx,
            ny,
            viewport: { width: 1100, height: 720 },
          });
        }}
      />
      <h2>Result contract</h2>
      <pre>{out}</pre>
    </main>
  );
};
