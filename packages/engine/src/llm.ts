export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmTurn = {
  text?: string;
  toolCalls: ToolCall[];
};

export interface DiscoverLlm {
  next(input: {
    goal: string;
    observation: string;
    history: string[];
    params?: Array<{ name: string; sensitivity?: string; description?: string }>;
  }): Promise<LlmTurn>;
}

export const buildDiscoverPrompt = (input: {
  goal: string;
  observation: string;
  history: string[];
  params?: Array<{ name: string; sensitivity?: string; description?: string }>;
}): string => {
  const declared = (input.params ?? [])
    .map((p) => `- ${p.name}${p.sensitivity && p.sensitivity !== "none" ? ` (${p.sensitivity})` : ""}`)
    .join("\n");
  return [
    `Goal: ${input.goal}`,
    `The page is an accessibility YAML snapshot. Act on [ref=eN] handles when present.`,
    declared
      ? `Declared parameters — use these exact names with paramRef. Never invent a name. Never put a raw PII value or the string "paramRef: …" into value.\n${declared}`
      : `Declared params should be referenced via paramRef, never raw values if they are PII.`,
    `After typing a parameter, click the submit control. Do not type the same field twice.`,
    `If the last history line says the page was unchanged, take a different action.`,
    `History:\n${input.history.join("\n") || "(none)"}`,
    `Current page:\n${input.observation}`,
    `Call exactly one tool.`,
  ].join("\n\n");
};

export const providerFromEnv = (): { provider: string; model: string } => ({
  provider: process.env.LLM_PROVIDER ?? "fake",
  model: process.env.LLM_MODEL ?? "fake",
});
