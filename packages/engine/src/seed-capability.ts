import type { Capability } from "@cur/schema";
import { loopbackPolicy } from "./policy.js";

const textChain = (text: string) => ({
  candidates: [{ strategy: "text" as const, text, weak: false }],
  fingerprint: { name: text, candidateCount: 1, framePath: [] as string[] },
  framePath: [] as string[],
});

const roleChain = (role: string, name: string) => ({
  candidates: [{ strategy: "role_name" as const, role, name, weak: false }],
  fingerprint: { role, name, candidateCount: 1, framePath: [] as string[] },
  framePath: [] as string[],
});

export const seedLookupBalance = (port: number): Capability => ({
  schemaVersion: "1.0.0",
  id: "lookup-savings-balance",
  name: "lookup_savings_balance",
  description: "Look up a member and read their current savings balance",
  revision: 1,
  status: "approved",
  appProfile: "mock-core-v1",
  provenance: {
    discoveryRunId: "seeded",
    modelId: "fake",
    createdAt: "2026-09-17T00:00:00.000Z",
    sourceHash: "seed",
  },
  riskClass: "reversible",
  policy: loopbackPolicy(port),
  parameters: [
    {
      name: "memberId",
      type: "string",
      required: true,
      sensitivity: "pii",
      description: "Credit-union member identifier",
    },
  ],
  outputs: [
    { name: "savingsBalance", type: "string", sensitivity: "none", description: "Current savings balance" },
  ],
  entry: { kind: "text", value: "Member lookup" },
  steps: [
    {
      id: "s1",
      action: "type",
      target: roleChain("textbox", "Member ID"),
      input: { kind: "paramRef", param: "memberId" },
      waitFor: { kind: "load", timeoutMs: 4000 },
      riskClass: "reversible",
      why: "Enter the member identifier into the lookup field",
    },
    {
      id: "s2",
      action: "click",
      target: roleChain("button", "Look up"),
      waitFor: { kind: "load", timeoutMs: 8000 },
      riskClass: "reversible",
      why: "Submit the member search",
    },
    {
      id: "s3",
      action: "extract",
      target: roleChain("status", "Savings balance"),
      outputName: "savingsBalance",
      waitFor: { kind: "text", value: "Savings balance", timeoutMs: 4000 },
      riskClass: "reversible",
      why: "Read the current savings balance from the member record",
    },
  ],
  outcomeDetectors: [
    { afterStep: 1, locator: textChain("No such member"), pattern: "No such member", outcome: "MEMBER_NOT_FOUND" },
    { afterStep: 1, locator: textChain("Permission denied"), pattern: "Permission denied", outcome: "PERMISSION_DENIED" },
    { afterStep: 1, locator: textChain("Account is frozen"), pattern: "Account is frozen", outcome: "ACCOUNT_FROZEN" },
    { afterStep: 1, locator: textChain("Estate hold"), pattern: "Estate hold", outcome: "ESTATE_HOLD" },
    { afterStep: 1, locator: textChain("Member ID must be"), pattern: "Member ID must be", outcome: "VALIDATION_FAILED" },
  ],
  success: { kind: "text", value: "Savings balance" },
  knownOutcomes: [
    { code: "MEMBER_NOT_FOUND", description: "No member exists for the supplied ID" },
    { code: "PERMISSION_DENIED", description: "Operator is not allowed to view this record" },
    { code: "ACCOUNT_FROZEN", description: "Fraud or operational freeze blocks servicing" },
    { code: "ESTATE_HOLD", description: "Deceased member — supervisor and letters required" },
    { code: "VALIDATION_FAILED", description: "Member ID failed field validation" },
  ],
});
