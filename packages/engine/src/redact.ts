import type { Parameter } from "@cur/schema";

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const ACCOUNT = /\b\d{10,17}\b/g;

export const redactText = (text: string, params: Parameter[], values: Record<string, string>): string => {
  let out = text;
  for (const p of params) {
    if (p.sensitivity === "none") continue;
    const v = values[p.name];
    if (v) out = out.split(v).join(`[redacted:${p.name}]`);
  }
  return out.replace(SSN, "[redacted:ssn]").replace(ACCOUNT, "[redacted:account]");
};

export const redactRecord = (
  rec: Record<string, unknown>,
  params: Parameter[],
  values: Record<string, string>,
): Record<string, unknown> => {
  const json = redactText(JSON.stringify(rec), params, values);
  return JSON.parse(json) as Record<string, unknown>;
};
