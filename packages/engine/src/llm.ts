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
  }): Promise<LlmTurn>;
}

export const providerFromEnv = (): { provider: string; model: string } => ({
  provider: process.env.LLM_PROVIDER ?? "fake",
  model: process.env.LLM_MODEL ?? "fake",
});
