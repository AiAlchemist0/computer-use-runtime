import { describe, expect, it } from "vitest";
import { redactText } from "@cur/engine";

describe("redaction", () => {
  it("strips declared PII and SSN-like tokens", () => {
    const out = redactText(
      "member 12345 ssn 111-22-3333 account 123456789012",
      [{ name: "memberId", type: "string", required: true, sensitivity: "pii", description: "id" }],
      { memberId: "12345" },
    );
    expect(out).not.toContain("12345");
    expect(out).not.toContain("111-22-3333");
    expect(out).toContain("[redacted:memberId]");
  });

  it("redacts extracted output values from why text", () => {
    const out = redactText(
      "Goal is visible as $1,842.17",
      [],
      {},
      ["$1,842.17"],
    );
    expect(out).not.toContain("1,842.17");
    expect(out).toContain("[redacted:output]");
  });
});
