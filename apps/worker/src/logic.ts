/**
 * Chromium-free logic the hosted demo can run honestly: the same PolicyGuard and Zod
 * schema the engine uses, plus pure transforms (Playwright codegen, route canonicalization).
 * Nothing here drives a browser.
 */
import { Capability, type Capability as CapabilityT } from "@cur/schema";
import { PolicyDenied, PolicyGuard, loopbackPolicy } from "../../../packages/engine/src/policy.js";

export type PolicyCheck = {
  allowed: boolean;
  check: "navigate" | "action";
  input: string;
  reason?: string;
  detail?: Record<string, unknown>;
  policy: ReturnType<PolicyGuard["snapshot"]>;
};

export const checkPolicy = (body: { url?: string; action?: string }): PolicyCheck => {
  const guard = new PolicyGuard(loopbackPolicy(4177));
  try {
    if (body.action) {
      guard.assertAction(body.action as never);
      return { allowed: true, check: "action", input: body.action, policy: guard.snapshot() };
    }
    const url = body.url ?? "";
    guard.assertNavigate(url);
    return { allowed: true, check: "navigate", input: url, policy: guard.snapshot() };
  } catch (err) {
    if (err instanceof PolicyDenied) {
      return {
        allowed: false,
        check: body.action ? "action" : "navigate",
        input: body.action ?? body.url ?? "",
        reason: err.reason,
        detail: err.detail,
        policy: guard.snapshot(),
      };
    }
    throw err;
  }
};

export const validateCapability = (raw: unknown) => {
  const r = Capability.safeParse(raw);
  if (r.success) {
    return {
      ok: true as const,
      id: r.data.id,
      status: r.data.status,
      steps: r.data.steps.length,
      outputs: r.data.outputs.map((o) => o.name),
      parameters: r.data.parameters.map((p) => `${p.name}:${p.type}${p.sensitivity !== "none" ? ` (${p.sensitivity})` : ""}`),
    };
  }
  return {
    ok: false as const,
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
};

/** Approval gate: same rule replay() applies before touching the browser. */
export const gateIrreversible = (body: { status?: "draft" | "approved"; confirmIrreversible?: boolean }) => {
  const status = body.status ?? "draft";
  const confirm = Boolean(body.confirmIrreversible);
  const allowed = status === "approved" && confirm;
  return {
    allowed,
    status,
    confirmIrreversible: confirm,
    result: allowed
      ? { status: "success", note: "Open sub-account click would run; the confirm screen is the success checkpoint." }
      : {
          status: "escalated",
          failure: {
            stepIndex: 3,
            expected: "approved + confirmIrreversible",
            observed: `status=${status}, confirmIrreversible=${confirm}`,
            code: "IRREVERSIBLE_GATED",
          },
          intervention: {
            reason: "IRREVERSIBLE_GATED",
            why: "irreversible step requires approved status and confirmIrreversible",
            controlOwner: "human",
          },
        },
  };
};

const locatorCode = (t: CapabilityT["steps"][number]["target"]): string => {
  const c = t?.candidates[0];
  if (!c) return "page";
  const scope = t?.framePath?.length ? `page.frameLocator(${JSON.stringify(t.framePath[0])})` : "page";
  if (c.strategy === "role_name" && c.role) return `${scope}.getByRole(${JSON.stringify(c.role)}, { name: ${JSON.stringify(c.name ?? "")} })`;
  if (c.strategy === "label" && c.text) return `${scope}.getByLabel(${JSON.stringify(c.text)})`;
  if (c.strategy === "text" && c.text) return `${scope}.getByText(${JSON.stringify(c.text)})`;
  return `${scope}.locator(${JSON.stringify(c.css ?? "body")})`;
};

/** Stretch goal: emit a runnable Playwright spec from the artifact. Pure transform. */
export const generatePlaywrightSpec = (cap: CapabilityT): string => {
  const lines: string[] = [];
  lines.push(`import { test, expect } from "@playwright/test";`);
  lines.push(``);
  lines.push(`// Generated from capability ${cap.id} rev ${cap.revision} (${cap.provenance.modelId}).`);
  lines.push(`// Params: ${cap.parameters.map((p) => `${p.name}: ${p.type}`).join(", ") || "none"}`);
  lines.push(`// Outputs: ${cap.outputs.map((o) => `${o.name}: ${o.type}`).join(", ") || "none"}`);
  lines.push(``);
  lines.push(`const params = { ${cap.parameters.map((p) => `${p.name}: process.env.${p.name.toUpperCase()} ?? ""`).join(", ")} };`);
  lines.push(``);
  lines.push(`test(${JSON.stringify(cap.name)}, async ({ page }) => {`);
  lines.push(`  await page.goto(process.env.TARGET ?? "http://127.0.0.1:4177/");`);
  lines.push(`  await expect(page.getByText(${JSON.stringify(cap.entry.value)})).toBeVisible(); // entry checkpoint`);
  for (const s of cap.steps) {
    const loc = locatorCode(s.target);
    lines.push(`  // ${s.id}: ${s.why}`);
    if (s.action === "type") {
      const val = s.input?.kind === "paramRef" ? `params.${s.input.param}` : JSON.stringify(s.input?.kind === "value" ? s.input.value : "");
      lines.push(`  await expect(${loc}).toHaveCount(1);`);
      lines.push(`  await ${loc}.fill(${val});`);
    } else if (s.action === "click" || s.action === "dismiss") {
      lines.push(`  await expect(${loc}).toHaveCount(1);`);
      lines.push(`  await ${loc}.click();`);
    } else if (s.action === "extract" && s.outputName) {
      lines.push(`  const ${s.outputName} = (await ${loc}.innerText()).trim();`);
      lines.push(`  expect(${s.outputName}).not.toBe("");`);
    }
    if (s.waitFor?.kind === "text" && s.waitFor.value) {
      lines.push(`  await expect(page.getByText(${JSON.stringify(s.waitFor.value)})).toBeVisible({ timeout: ${s.waitFor.timeoutMs} });`);
    }
  }
  for (const d of cap.outcomeDetectors) {
    lines.push(`  // business outcome ${d.outcome}: "${d.pattern}" is a legitimate result, not a test failure`);
  }
  const success = cap.success.kind === "role_name" && cap.success.role
    ? `page.getByRole(${JSON.stringify(cap.success.role)}, { name: ${JSON.stringify(cap.success.name ?? cap.success.value)} })`
    : `page.getByText(${JSON.stringify(cap.success.value)})`;
  lines.push(`  await expect(${success}).toBeVisible(); // success checkpoint`);
  lines.push(`});`);
  return `${lines.join("\n")}\n`;
};

/** Stretch goal: canonicalize concrete routes and values into parameterized patterns. */
export const canonicalize = (url: string, values: Record<string, string>) => {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* treat as a path */
  }
  let pattern = path;
  const bound: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (value && pattern.includes(value)) {
      pattern = pattern.split(value).join(`:${name}`);
      bound.push(name);
    }
  }
  pattern = pattern.replace(/\/\d{4,}(?=\/|$)/g, "/:id");
  return { input: path, pattern, bound };
};

/** Stretch goal: the same capability applied to a second tenant skin with one locator override. */
export const TENANTS = [
  {
    id: "base",
    label: "MockCore CU (base)",
    appProfile: "mock-core-v1",
    baseUrl: "http://127.0.0.1:4177",
    locatorOverrides: {},
    replay: { status: "success", driftWarnings: [] },
  },
  {
    id: "harbor",
    label: "Harbor FCU (same vendor, renamed control)",
    appProfile: "mock-core-v1",
    baseUrl: "https://core.harbor-fcu.example",
    locatorOverrides: {
      s2: { strategy: "role_name", role: "button", name: "Search member" },
    },
    replay: {
      status: "success",
      driftWarnings: [{ stepIndex: 1, expected: 'button "Look up" count=1', observed: 'override → button "Search member" count=1' }],
    },
  },
] as const;
