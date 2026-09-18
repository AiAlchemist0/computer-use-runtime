import { type Browser, type BrowserContext, type Locator, type Page, chromium } from "playwright";
import type { ActionType, Checkpoint, LocatorCandidate, LocatorChain } from "@cur/schema";
import { PolicyDenied, PolicyGuard } from "./policy.js";
import type { ActRequest, ExtractResult, HumanPointer, ObserveResult, SurfaceAdapter } from "./interfaces.js";
import type { Session } from "./session.js";

export type WebAdapterOptions = {
  policy: PolicyGuard;
  session?: Session;
  headless?: boolean;
  cdpUrl?: string;
  extraHeaders?: Record<string, string>;
  trace?: boolean;
};

export class WebAdapter implements SurfaceAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private session: Session | undefined;

  constructor(private readonly opts: WebAdapterOptions) {
    this.session = opts.session;
  }

  bindSession(session: Session): void {
    this.session = session;
  }

  isOpen(): boolean {
    return this.page != null;
  }

  async launch(startUrl?: string): Promise<void> {
    if (this.opts.cdpUrl) {
      this.browser = await chromium.connectOverCDP(this.opts.cdpUrl);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    } else {
      this.browser = await chromium.launch({ headless: this.opts.headless !== false });
      this.context = await this.browser.newContext({ viewport: { width: 1100, height: 720 } });
    }
    if (this.opts.extraHeaders) {
      await this.context.setExtraHTTPHeaders(this.opts.extraHeaders);
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    if (this.opts.trace) {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page?.mainFrame()) {
        try {
          this.opts.policy.assertNavigate(frame.url());
        } catch {
          /* replay/discover will surface PolicyDenied on the next act */
        }
      }
    });
    await this.page.route("**/*", (route) => {
      const url = route.request().url();
      try {
        if (url.startsWith("http")) this.opts.policy.assertHost(url);
        return route.continue();
      } catch (err) {
        if (err instanceof PolicyDenied) return route.abort();
        throw err;
      }
    });
    if (startUrl) {
      this.opts.policy.assertNavigate(startUrl);
      await this.page.goto(startUrl, { waitUntil: "domcontentloaded" });
    }
  }

  pageOrThrow(): Page {
    if (!this.page) throw new Error("adapter not launched");
    return this.page;
  }

  async observe(opts?: { screenshot?: boolean }): Promise<ObserveResult> {
    const page = this.pageOrThrow();
    this.opts.policy.assertNavigate(page.url());
    const aria = await snapshotForAi(page);
    const shot = opts?.screenshot ? await page.screenshot({ type: "png" }) : undefined;
    return { url: page.url(), title: await page.title(), aria, screenshotPng: shot };
  }

  async resolve(chain: LocatorChain): Promise<{ count: number; handleOk: boolean }> {
    const loc = this.locatorFromChain(chain);
    const count = await loc.count();
    return { count, handleOk: count === 1 };
  }

  async act(req: ActRequest): Promise<void> {
    this.session?.assertAgent();
    this.opts.policy.assertAction(req.action);
    this.opts.policy.assertNavigate(this.pageOrThrow().url());
    const page = this.pageOrThrow();
    if (req.action === "navigate" && req.value) {
      this.opts.policy.assertNavigate(req.value);
      await page.goto(req.value, { waitUntil: "domcontentloaded" });
      return;
    }
    if (req.action === "wait") {
      await page.waitForTimeout(Number(req.value ?? 300));
      return;
    }
    if (req.action === "press") {
      await page.keyboard.press(req.value ?? "Enter");
      return;
    }
    if (!req.target) throw new Error(`action ${req.action} requires a target`);
    const loc = await this.uniqueLocator(req.target);
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    switch (req.action) {
      case "click":
      case "dismiss":
        await loc.click();
        break;
      case "type":
        await loc.fill(req.value ?? "");
        break;
      case "select":
        await loc.selectOption(req.value ?? "");
        break;
      case "extract":
      case "assert":
        break;
      default:
        throw new Error(`unsupported action ${req.action}`);
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }

  async extract(chain: LocatorChain): Promise<ExtractResult> {
    const loc = await this.uniqueLocator(chain);
    const text = ((await loc.innerText()) ?? (await loc.inputValue().catch(() => ""))).trim();
    return { text };
  }

  async screenshot(opts?: { mask?: LocatorChain[] }): Promise<Buffer> {
    const page = this.pageOrThrow();
    const mask = (opts?.mask ?? []).map((chain) => this.locatorFromChain(chain));
    return page.screenshot({
      type: "jpeg",
      quality: 55,
      mask: mask.length ? mask : undefined,
      timeout: 8000,
      animations: "disabled",
    });
  }

  async waitFor(kind: "url" | "element" | "text" | "load", value?: string, timeoutMs = 8000): Promise<void> {
    const page = this.pageOrThrow();
    if (kind === "load") {
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      return;
    }
    if (kind === "url" && value) {
      await page.waitForURL((u) => u.toString().includes(value), { timeout: timeoutMs });
      return;
    }
    if (kind === "text" && value) {
      await page.getByText(value, { exact: false }).first().waitFor({ timeout: timeoutMs });
      return;
    }
    if (kind === "element" && value) {
      const [role, name] = value.includes(":") ? value.split(":") : ["button", value];
      const loc = name
        ? page.getByRole((role || "button") as "button", { name })
        : page.getByRole((role || "button") as "button");
      await loc.first().waitFor({ timeout: timeoutMs });
    }
  }

  async pause(): Promise<void> {
    /* no-op: ownership is enforced by Session */
  }

  async injectHumanInput(
    kind: "click" | "type" | "press",
    payload: HumanPointer | { text?: string; key?: string },
  ): Promise<void> {
    const page = this.pageOrThrow();
    if (kind === "click" && "nx" in payload) {
      const { x, y } = this.toPixels(payload);
      await page.mouse.click(x, y);
      return;
    }
    if (kind === "type" && "text" in payload && payload.text) {
      await page.keyboard.type(payload.text);
      return;
    }
    if (kind === "press" && "key" in payload && payload.key) {
      await page.keyboard.press(payload.key);
    }
  }

  async elementAtPoint(
    nx: number,
    ny: number,
    viewport: { width: number; height: number },
  ): Promise<LocatorChain | null> {
    const page = this.pageOrThrow();
    const { x, y } = this.toPixels({ nx, ny, viewport });
    const info = await page.evaluate(
      ({ x, y }) => {
        const raw = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!raw) return null;
        const el =
          (raw.closest("button, a, input, label, [role='button'], [role='textbox'], h1, h2") as HTMLElement | null) ??
          raw;
        if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "STYLE" || el.tagName === "HEAD") {
          return null;
        }
        const role =
          el.getAttribute("role") ||
          (el.tagName === "BUTTON" ? "button" : el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? "textbox" : el.tagName.toLowerCase());
        const name = (el.getAttribute("aria-label") || el.getAttribute("name") || el.textContent || "")
          .trim()
          .slice(0, 80);
        return { role, name };
      },
      { x, y },
    );
    if (!info) return null;
    return {
      candidates: [{ strategy: "role_name", role: info.role, name: info.name, weak: false }],
      fingerprint: { role: info.role, name: info.name, candidateCount: 1, framePath: [] },
      framePath: [],
    };
  }

  async url(): Promise<string> {
    return this.pageOrThrow().url();
  }

  async assertCheckpoint(cp: Checkpoint): Promise<boolean> {
    const page = this.pageOrThrow();
    if (cp.kind === "url") return page.url().includes(cp.value);
    if (cp.kind === "title") return (await page.title()).includes(cp.value);
    if (cp.kind === "text") {
      if ((await page.getByText(cp.value).count()) > 0) return true;
      for (const frame of page.frames()) {
        if ((await frame.getByText(cp.value).count()) > 0) return true;
      }
      return false;
    }
    if (cp.kind === "role_name" && cp.role && cp.name) {
      return (await page.getByRole(cp.role as "button", { name: cp.name }).count()) > 0;
    }
    return false;
  }

  async startTrace(): Promise<void> {
    await this.context?.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }

  async stopTrace(path: string): Promise<void> {
    await this.context?.tracing.stop({ path });
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  locatorFromChain(chain: LocatorChain): Locator {
    const c = chain.candidates[0];
    if (!c) throw new Error("empty locator chain");
    return this.locatorForCandidate(chain.framePath, c);
  }

  async uniqueLocator(chain: LocatorChain): Promise<Locator> {
    const page = this.pageOrThrow();
    let lastAmbiguous = false;
    for (const c of chain.candidates) {
      const loc = this.locatorForCandidate(chain.framePath, c);
      const count = await loc.count();
      if (count === 1) return loc;
      if (count > 1) lastAmbiguous = true;
    }
    if (!chain.framePath.length) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        for (const c of chain.candidates) {
          const framed =
            c.strategy === "role_name" && c.role
              ? frame.getByRole(c.role as "generic", { name: c.name })
              : c.text
                ? frame.getByText(c.text)
                : null;
          if (framed && (await framed.count()) === 1) return framed;
        }
      }
    }
    if (lastAmbiguous) throw Object.assign(new Error("AMBIGUOUS_TARGET"), { code: "AMBIGUOUS_TARGET" });
    throw Object.assign(new Error("TARGET_NOT_FOUND"), { code: "TARGET_NOT_FOUND" });
  }

  private locatorForCandidate(framePath: string[], c: LocatorCandidate): Locator {
    const page = this.pageOrThrow();
    if (framePath.length) {
      let fl = page.frameLocator(framePath[0] ?? "iframe");
      for (const sel of framePath.slice(1)) fl = fl.frameLocator(sel);
      if (c.strategy === "role_name" && c.role) return fl.getByRole(c.role as "textbox", { name: c.name });
      if (c.strategy === "text" && c.text) return fl.getByText(c.text);
      if (c.strategy === "label" && c.text) return fl.getByLabel(c.text);
    }
    return this.candidateToLocator(page, c);
  }

  private candidateToLocator(page: Page, c: LocatorCandidate): Locator {
    if (c.strategy === "role_name" && c.role) {
      const loc = page.getByRole(c.role as "textbox", { name: c.name });
      return c.nth != null ? loc.nth(c.nth) : loc;
    }
    if (c.strategy === "label" && c.text) return page.getByLabel(c.text);
    if (c.strategy === "text" && c.text) return page.getByText(c.text);
    if (c.strategy === "nth_role" && c.role) return page.getByRole(c.role as "button").nth(c.nth ?? 0);
    if (c.strategy === "css" && c.css) return page.locator(c.css);
    throw new Error(`unresolvable candidate ${c.strategy}`);
  }

  private toPixels(p: HumanPointer): { x: number; y: number } {
    const box = this.pageOrThrow().viewportSize() ?? p.viewport;
    return {
      x: Math.round(p.nx * box.width),
      y: Math.round(p.ny * box.height),
    };
  }
}

export const snapshotForAi = async (page: Page): Promise<string> => {
  const loc = page.locator("body");
  const snap = loc.ariaSnapshot as (opts?: Record<string, unknown>) => Promise<string>;
  const attempts: Array<Record<string, unknown>> = [{ timeout: 5000, mode: "ai" }, { timeout: 5000, ref: true }, { timeout: 5000 }];
  for (const opts of attempts) {
    try {
      return await snap.call(loc, opts);
    } catch {
      /* try the next option set */
    }
  }
  return page.innerText("body");
};

export const parseAriaRefs = (aria: string): Array<{ role: string; name: string; ref: string }> => {
  const out: Array<{ role: string; name: string; ref: string }> = [];
  const re = /([a-z][\w-]*)\s+"([^"]+)"\s+\[ref=([eE]\d+[a-z0-9]*)\]/g;
  for (const m of aria.matchAll(re)) {
    out.push({ role: m[1]!, name: m[2]!, ref: m[3]! });
  }
  return out;
};

export const deriveChainFromRef = async (page: Page, ref: string): Promise<LocatorChain> => {
  const loc = page.locator(`aria-ref=${ref}`);
  const count = await loc.count();
  const role = (await loc.getAttribute("role").catch(() => null)) ?? undefined;
  const name =
    (await loc.getAttribute("aria-label").catch(() => null)) ??
    (await loc.innerText().catch(() => "")).trim().slice(0, 80);
  const inferredRole = role ?? ((await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "generic")) || "generic");
  const mapped = inferredRole === "input" || inferredRole === "textarea" ? "textbox" : inferredRole === "button" ? "button" : inferredRole;
  return {
    candidates: [{ strategy: "role_name", role: mapped, name, weak: false }],
    fingerprint: { role: mapped, name, candidateCount: count || 1, framePath: [] },
    framePath: [],
  };
};

export const deriveChain = async (
  page: Page,
  action: ActionType,
  hint: { role?: string; name?: string; label?: string },
): Promise<LocatorChain> => {
  const role = hint.role ?? (action === "type" ? "textbox" : "button");
  const name = hint.name ?? hint.label ?? "";
  const loc = name ? page.getByRole(role as "textbox", { name }) : page.getByRole(role as "button");
  const count = await loc.count();
  return {
    candidates: [
      { strategy: "role_name", role, name, weak: false },
      ...(hint.label ? [{ strategy: "label" as const, text: hint.label, weak: false }] : []),
    ],
    fingerprint: { role, name, candidateCount: count, framePath: [] },
    framePath: [],
  };
};
