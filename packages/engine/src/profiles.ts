import type { AppProfile, LocatorChain } from "@cur/schema";

const role = (r: string, name: string): LocatorChain => ({
  candidates: [{ strategy: "role_name", role: r, name, weak: false }],
  fingerprint: { role: r, name, candidateCount: 1, framePath: [] },
  framePath: [],
});

export const mockBankProfile = (): AppProfile => ({
  id: "mock-core-v1",
  vendorProduct: "MockCore CU",
  entry: { kind: "text", value: "Member lookup" },
  sessionExpired: { kind: "text", value: "Session expired" },
  interstitials: [
    {
      id: "unexpected-dialog",
      detect: role("button", "Dismiss notice"),
      dismiss: { action: "click", target: role("button", "Dismiss notice") },
    },
  ],
  errorPatterns: [
    { code: "MEMBER_NOT_FOUND", pattern: "No such member" },
    { code: "PERMISSION_DENIED", pattern: "Permission denied" },
    { code: "ACCOUNT_FROZEN", pattern: "Account is frozen" },
    { code: "ESTATE_HOLD", pattern: "Estate hold" },
    { code: "VALIDATION_FAILED", pattern: "Member ID must be" },
    { code: "SESSION_EXPIRED", pattern: "Session expired" },
    { code: "TIMEOUT", pattern: "The core is not responding" },
  ],
});

export const resolveProfile = (id: string): AppProfile | null => (id === "mock-core-v1" ? mockBankProfile() : null);
