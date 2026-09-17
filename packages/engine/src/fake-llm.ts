import type { DiscoverLlm, LlmTurn } from "./llm.js";

export type ScriptedCall = {
  name: string;
  arguments: Record<string, unknown>;
};

/** Deterministic discover driver for tests and --llm fake. */
export class FakeLlm implements DiscoverLlm {
  private i = 0;
  constructor(private readonly script: ScriptedCall[]) {}

  async next(): Promise<LlmTurn> {
    const step = this.script[this.i];
    this.i += 1;
    if (!step) return { toolCalls: [{ name: "finish", arguments: { why: "script exhausted" } }] };
    return { toolCalls: [step] };
  }
}

export const lookupBalanceScript = (memberIdParam = "memberId"): ScriptedCall[] => [
  {
    name: "type",
    arguments: {
      role: "textbox",
      name: "Member ID",
      paramRef: memberIdParam,
      why: "Enter the member identifier into the lookup field",
    },
  },
  {
    name: "click",
    arguments: { role: "button", name: "Look up", why: "Submit the member search" },
  },
  {
    name: "extract",
    arguments: {
      role: "status",
      name: "Savings balance",
      outputName: "savingsBalance",
      why: "Read the current savings balance from the member record",
    },
  },
  { name: "finish", arguments: { why: "Balance is visible; goal met" } },
];

export const openSubAccountScript = (memberIdParam = "memberId"): ScriptedCall[] => [
  {
    name: "type",
    arguments: {
      role: "textbox",
      name: "Member ID",
      paramRef: memberIdParam,
      why: "Identify the member before opening a sub-account",
    },
  },
  {
    name: "click",
    arguments: { role: "button", name: "Look up", why: "Open the member record" },
  },
  {
    name: "click",
    arguments: { role: "button", name: "Open sub-account", why: "Start the irreversible sub-account flow" },
  },
  { name: "finish", arguments: { why: "Reached confirmation screen" } },
];
