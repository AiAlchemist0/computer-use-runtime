import { describe, expect, it } from "vitest";
import { PolicyDenied, PolicyGuard } from "@cur/engine";

describe("policy", () => {
  const guard = new PolicyGuard({
    allowHosts: ["127.0.0.1"],
    allowRoutes: ["/"],
    allowActions: ["click", "type", "extract", "navigate"],
  });

  it("denies a foreign host", () => {
    expect(() => guard.assertHost("https://evil.example/")).toThrow(PolicyDenied);
  });

  it("denies a disallowed action", () => {
    expect(() => guard.assertAction("press")).toThrow(PolicyDenied);
  });

  it("does not treat / as a prefix of every path", () => {
    expect(() => guard.assertNavigate("http://127.0.0.1:4177/lookup")).toThrow(PolicyDenied);
  });

  it("allows an explicit lookup route", () => {
    const open = new PolicyGuard({
      allowHosts: ["127.0.0.1"],
      allowRoutes: ["/", "/lookup", "/member"],
      allowActions: ["navigate"],
    });
    expect(() => open.assertNavigate("http://127.0.0.1:4177/lookup")).not.toThrow();
    expect(() => open.assertNavigate("http://127.0.0.1:4177/member/12345")).not.toThrow();
  });

  it("denies a disallowed route", () => {
    const tight = new PolicyGuard({
      allowHosts: ["127.0.0.1"],
      allowRoutes: ["/allowed"],
      allowActions: ["navigate"],
    });
    expect(() => tight.assertNavigate("http://127.0.0.1/other")).toThrow(PolicyDenied);
  });
});
