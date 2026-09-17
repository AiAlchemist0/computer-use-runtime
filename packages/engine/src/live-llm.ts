import type { DiscoverLlm, LlmTurn } from "./llm.js";

/**
 * Optional live provider via Vercel AI SDK.
 * Loaded dynamically so tests and --llm fake need no provider packages.
 */
export const createLiveLlm = async (): Promise<DiscoverLlm> => {
  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  const modelId = process.env.LLM_MODEL ?? "";
  if (!provider || provider === "fake") {
    throw new Error("LLM_PROVIDER is fake or empty; use FakeLlm");
  }

  const { generateText, tool } = await import("ai");
  const { z } = await import("zod");

  const model = await loadModel(provider, modelId);

  const tools = {
    type: tool({
      description: "Type into a control identified by role and accessible name. Prefer paramRef for declared parameters.",
      inputSchema: z.object({
        role: z.string(),
        name: z.string(),
        paramRef: z.string().optional(),
        value: z.string().optional(),
        why: z.string(),
      }),
    }),
    click: tool({
      description: "Click a control identified by role and accessible name.",
      inputSchema: z.object({ role: z.string(), name: z.string(), why: z.string() }),
    }),
    extract: tool({
      description: "Read text from a control into a named output.",
      inputSchema: z.object({
        role: z.string(),
        name: z.string(),
        outputName: z.string(),
        why: z.string(),
      }),
    }),
    finish: tool({
      description: "Goal is met.",
      inputSchema: z.object({ why: z.string() }),
    }),
    escalate: tool({
      description: "Cannot safely continue.",
      inputSchema: z.object({ why: z.string() }),
    }),
  };

  return {
    async next({ goal, observation, history }): Promise<LlmTurn> {
      const result = await generateText({
        model,
        tools,
        prompt: [
          `Goal: ${goal}`,
          `Declared params should be referenced via paramRef, never raw values if they are PII.`,
          `History:\n${history.join("\n")}`,
          `Current page:\n${observation}`,
          `Call exactly one tool.`,
        ].join("\n\n"),
      });
      const first = result.toolCalls[0];
      if (!first) return { text: result.text, toolCalls: [{ name: "finish", arguments: { why: result.text || "no tool" } }] };
      return {
        text: result.text,
        toolCalls: [{ name: first.toolName, arguments: first.input as Record<string, unknown> }],
      };
    },
  };
};

const loadModel = async (provider: string, modelId: string) => {
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI()(modelId || "gpt-4.1-mini");
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic()(modelId || "claude-sonnet-4-5");
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI()(modelId || "gemini-2.5-flash");
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai()(modelId || "grok-3-mini");
    }
    case "openrouter": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelId || "openai/gpt-4.1-mini");
    }
    default:
      throw new Error(`Unsupported LLM_PROVIDER=${provider}`);
  }
};
