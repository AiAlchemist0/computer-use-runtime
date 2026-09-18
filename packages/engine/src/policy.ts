import type { ActionType, PolicySnapshot } from "@cur/schema";

export class PolicyDenied extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = "PolicyDenied";
  }
}

export class PolicyGuard {
  constructor(private readonly policy: PolicySnapshot) {}

  snapshot(): PolicySnapshot {
    return this.policy;
  }

  assertHost(url: string): void {
    const host = safeHost(url);
    const ok = this.policy.allowHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) throw new PolicyDenied("host not allowlisted", { host, url });
  }

  assertRoute(url: string): void {
    const path = safePath(url);
    const ok = this.policy.allowRoutes.some((r) => routeMatches(path, r));
    if (!ok) throw new PolicyDenied("route not allowlisted", { path, url });
  }

  assertAction(action: ActionType): void {
    if (!this.policy.allowActions.includes(action)) {
      throw new PolicyDenied("action not allowlisted", { action });
    }
  }

  assertNavigate(url: string): void {
    this.assertHost(url);
    this.assertRoute(url);
  }
}

export const loopbackPolicy = (_port: number): PolicySnapshot => ({
  allowHosts: ["127.0.0.1", "localhost"],
  allowRoutes: ["/", "/lookup", "/member"],
  allowActions: ["navigate", "click", "type", "select", "press", "extract", "wait", "assert", "dismiss"],
});

const routeMatches = (path: string, allowed: string): boolean => {
  if (allowed === "/") return path === "/" || path === "";
  return path === allowed || path.startsWith(allowed.endsWith("/") ? allowed : `${allowed}/`);
};

const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

const safePath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
};
