import { CASES, recordedReplay, type RecordedCase } from "./cases.js";

export type ChatSource = "llm" | "matcher";

export type ChatResolution = {
  memberId: string;
  reply: string;
  source: ChatSource;
  lookup?: boolean;
};

const HINTS: Array<{ id: string; keys: string[] }> = [
  { id: "12345", keys: ["nguyen", "payroll", "thursday", "12345", "known member"] },
  { id: "22222", keys: ["okonkwo", "joint", "household", "22222"] },
  { id: "33440", keys: ["patel", "welcome", "new member", "zero", "33440"] },
  { id: "44551", keys: ["berg", "dormant", "reactivat", "44551"] },
  { id: "55667", keys: ["alvarez", "nsf", "thin", "overdrawn", "55667"] },
  { id: "99001", keys: ["ito", "custodial", "utma", "minor", "99001"] },
  { id: "66778", keys: ["whitman", "frozen", "freeze", "fraud", "stolen", "66778"] },
  { id: "77889", keys: ["cole", "estate", "death", "deceased", "77889"] },
  { id: "88888", keys: ["restricted", "bsa", "permission", "88888"] },
  { id: "99999", keys: ["not on file", "not found", "wrong number", "99999"] },
  { id: "1010", keys: ["four digit", "mistyp", "debit card", "short id", "1010", "bad id"] },
];

export const isGreeting = (message: string): boolean =>
  /^(hi|hello|hey|yo|thanks|thank you|good (morning|afternoon|evening)|how are you|what can you do|help)[\s!.?]*$/i.test(
    message.trim(),
  );

export const CLARIFY =
  "Give me a name or a five-digit member number and I will pull the savings record. For example: what posted after Thursday’s payroll for A. Nguyen?";

const sessionOf = (id?: string) => (id ? CASES.find((row) => row.id === id) : undefined);

export const clarifyFor = (c?: RecordedCase): string => {
  if (!c) return CLARIFY;
  return `This window is ${c.label} · ${c.id}. ${c.teller} Name or that five-digit number and I will pull the savings record.`;
};

export const replyFor = (c: RecordedCase): string => {
  if (c.outcome === "success") {
    return `${c.name ?? "This member"} is on file. Primary savings shows ${c.savings ?? "the posted balance"}.`;
  }
  if (c.outcome === "ACCOUNT_FROZEN") {
    return "I opened that record. Servicing is blocked — the account is frozen. A supervisor has to take it from here.";
  }
  if (c.outcome === "ESTATE_HOLD") {
    return "I cannot release a balance on that number. Estate hold — letters and a supervisor first.";
  }
  if (c.outcome === "PERMISSION_DENIED") {
    return "Teller-07 cannot open that file. Permission denied.";
  }
  if (c.outcome === "MEMBER_NOT_FOUND") {
    return "Nothing on file under that number.";
  }
  if (c.outcome === "VALIDATION_FAILED") {
    return "That is not a five-digit member ID. The lookup will reject it.";
  }
  return c.teller;
};

export const matchChat = (message: string, sessionId?: string): ChatResolution => {
  const session = sessionOf(sessionId);
  if (isGreeting(message)) {
    return { memberId: session?.id ?? "12345", reply: clarifyFor(session), source: "matcher", lookup: false };
  }
  const text = message.toLowerCase();
  const digits = message.match(/\b(\d{4,5})\b/);
  if (digits?.[1]) {
    const raw = digits[1];
    const hit = CASES.find((row) => row.id === raw) ?? CASES.find((row) => row.id === raw.padStart(5, "0"));
    if (hit) return { memberId: hit.id, reply: replyFor(hit), source: "matcher" };
    if (raw.length !== 5) {
      const bad = CASES.find((row) => row.id === "1010")!;
      return { memberId: bad.id, reply: replyFor(bad), source: "matcher" };
    }
    return {
      memberId: raw,
      reply: "I do not have that number in this morning’s book. I will still send it through the lookup.",
      source: "matcher",
    };
  }

  const scored = HINTS.map((hint) => ({
    id: hint.id,
    n: hint.keys.reduce((sum, key) => sum + (text.includes(key) ? 1 : 0), 0),
  }))
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n)[0];

  if (scored) {
    const hit = CASES.find((row) => row.id === scored.id)!;
    return { memberId: hit.id, reply: replyFor(hit), source: "matcher" };
  }

  if (session) {
    return { memberId: session.id, reply: replyFor(session), source: "matcher" };
  }

  return { memberId: "12345", reply: CLARIFY, source: "matcher", lookup: false };
};

type LlmEnv = {
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  VENICE_API_KEY?: string;
  VENICE_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
};

const pickLlm = (env: LlmEnv) => {
  const named = (env.LLM_PROVIDER ?? "").toLowerCase();
  if (named === "zai" || named === "z.ai" || named === "glm") {
    return {
      provider: "zai",
      key: env.ZAI_API_KEY,
      base: (env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
      model: env.LLM_MODEL || "glm-5.3-flash",
    };
  }
  if (named === "venice") {
    return {
      provider: "venice",
      key: env.VENICE_API_KEY,
      base: (env.VENICE_BASE_URL || "https://api.venice.ai/api/v1").replace(/\/$/, ""),
      model: env.LLM_MODEL || "z-ai-glm-5-3-flash",
    };
  }
  if (named === "openai") {
    return {
      provider: "openai",
      key: env.OPENAI_API_KEY,
      base: "https://api.openai.com/v1",
      model: env.LLM_MODEL || "gpt-4.1-mini",
    };
  }
  if (env.ZAI_API_KEY) {
    return {
      provider: "zai",
      key: env.ZAI_API_KEY,
      base: (env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/$/, ""),
      model: env.LLM_MODEL || "glm-5.3-flash",
    };
  }
  if (env.VENICE_API_KEY) {
    return {
      provider: "venice",
      key: env.VENICE_API_KEY,
      base: (env.VENICE_BASE_URL || "https://api.venice.ai/api/v1").replace(/\/$/, ""),
      model: env.LLM_MODEL || "z-ai-glm-5-3-flash",
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      key: env.OPENAI_API_KEY,
      base: "https://api.openai.com/v1",
      model: env.LLM_MODEL || "gpt-4.1-mini",
    };
  }
  return null;
};

const messageText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text?: string }).text ?? "");
        return "";
      })
      .join("\n");
  }
  return "";
};

const catalog = () =>
  CASES.map(
    (c) =>
      `${c.id} | ${c.label} | ${c.name ?? "—"} | ${c.outcome} | ${c.savings ?? "n/a"} | ${c.teller}`,
  ).join("\n");

const parseJson = (raw: string): { memberId?: string; reply?: string; lookup?: boolean } | null => {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as { memberId?: string; reply?: string; lookup?: boolean };
  } catch {
    return null;
  }
};

export const llmChat = async (env: LlmEnv, message: string, sessionId?: string): Promise<ChatResolution | null> => {
  const picked = pickLlm(env);
  if (!picked?.key) return null;
  const session = sessionOf(sessionId);

  const payload: Record<string, unknown> = {
    model: picked.model,
    temperature: picked.provider === "zai" ? 0.3 : 0.2,
    messages: [
      {
        role: "system",
        content: [
          "You are TELLER-07 at MockCore member servicing. You only look up a primary savings balance from today’s walk-in book.",
          "You cannot take withdrawals, deposits, transfers, open accounts, or quote checking unless the catalog already has it.",
          "Speak to the operator at the window, not to the member. Do not say “Hi, A. Nguyen”.",
          "If they ask what posted, quote the catalog savings figure as the posted balance. Do not apologize for a missing ledger.",
          "One or two short sentences. No jargon.",
          "Never invent a name or a balance. Use only the catalog.",
          session
            ? `This teller window is already on walk-in ${session.id} (${session.label}, ${session.name ?? "unnamed"}). Prefer that case unless the question clearly names another member.`
            : "",
          "Return JSON only: {\"memberId\":\"12345\",\"reply\":\"spoken answer\",\"lookup\":true}",
          "Greeting or unclear request: {\"memberId\":\"\",\"reply\":\"ask for a name or five-digit member ID\",\"lookup\":false}",
          "Catalog (id | label | name | outcome | savings | walk-in):",
          catalog(),
        ].filter(Boolean).join("\n"),
      },
      { role: "user", content: message.slice(0, 500) },
    ],
    response_format: { type: "json_object" },
  };
  if (picked.provider === "zai") {
    payload.thinking = { type: "enabled", clear_thinking: true };
    payload.reasoning_effort = "low";
  }

  const res = await fetch(`${picked.base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${picked.key}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: string } }>;
  };
  const raw = messageText(json.choices?.[0]?.message?.content) || json.choices?.[0]?.message?.reasoning_content || "";
  const parsed = parseJson(raw);
  if (!parsed?.reply) return null;
  const known = parsed.memberId ? CASES.find((row) => row.id === parsed.memberId) : session;
  const lookup = Boolean(known) && parsed.lookup !== false;
  return {
    memberId: known?.id ?? session?.id ?? "12345",
    reply: parsed.reply.slice(0, 400),
    source: "llm",
    lookup,
  };
};

export const resolveChat = async (env: LlmEnv, message: string, sessionId?: string): Promise<ChatResolution> => {
  const fallback = matchChat(message, sessionId);
  if (isGreeting(message)) return fallback;
  try {
    const live = await llmChat(env, message, sessionId);
    if (live) return live;
  } catch {
    /* matcher stays the public demo */
  }
  return fallback;
};

export const chatReplay = async (env: LlmEnv, message: string, sessionId?: string) => {
  const trimmed = (message ?? "").trim();
  const session = sessionOf(sessionId);
  const resolution = await resolveChat(
    env,
    trimmed || (session ? `look up ${session.id}` : "payroll for Nguyen"),
    sessionId,
  );
  return {
    ...resolution,
    result:
      resolution.lookup === false
        ? { status: "idle", memberId: resolution.memberId }
        : recordedReplay(resolution.memberId),
  };
};
