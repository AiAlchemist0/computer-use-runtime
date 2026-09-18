import type { Parameter } from "@cur/schema";

const fold = (s: string) => s.toLowerCase().replace(/[_-]/g, "");

export const normalizeParamRef = (raw: string | undefined, params: Parameter[]): string => {
  const name = (raw ?? "").trim();
  if (!name) throw Object.assign(new Error("empty paramRef"), { code: "UNKNOWN_PARAM_REF" });
  const exact = params.find((p) => p.name === name);
  if (exact) return exact.name;
  const hit = params.find((p) => fold(p.name) === fold(name));
  if (hit) return hit.name;
  throw Object.assign(new Error(`unknown paramRef ${name}`), { code: "UNKNOWN_PARAM_REF" });
};

export const coerceParamRef = (args: Record<string, unknown>, params: Parameter[]): string | undefined => {
  const direct = args.paramRef != null ? String(args.paramRef) : undefined;
  const fromValue =
    typeof args.value === "string" && /^paramRef\s*:/i.test(args.value)
      ? args.value.replace(/^paramRef\s*:/i, "").trim()
      : undefined;
  const raw = direct || fromValue;
  if (!raw) return undefined;
  return normalizeParamRef(raw, params);
};

export const isDiscoverComplete = (steps: Array<{ action: string }>, finished: boolean): boolean =>
  finished && steps.some((s) => s.action === "extract");
