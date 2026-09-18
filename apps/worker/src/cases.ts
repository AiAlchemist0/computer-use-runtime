export type RecordedCase = {
  id: string;
  ticket: string;
  label: string;
  reason: string;
  teller: string;
  analyst: string;
  outcome: string;
  name?: string;
  savings?: string;
  checking?: string;
  status?: string;
  relationship?: string;
  flag?: string;
};

export const CASES: RecordedCase[] = [
  {
    id: "12345",
    ticket: "Q-014",
    label: "Known member",
    reason: "Payroll balance inquiry",
    teller: "A. Nguyen asks what posted after Thursday’s payroll.",
    analyst: "Happy-path extract of primary savings.",
    outcome: "success",
    name: "A. Nguyen",
    savings: "$1,842.17",
    checking: "$410.22",
    status: "Active",
    relationship: "Primary",
  },
  {
    id: "22222",
    ticket: "Q-015",
    label: "Joint household",
    reason: "Joint owner verification",
    teller: "M. Okonkwo and P. Okonkwo want both names on the printout.",
    analyst: "Same capability, larger balance, joint relationship.",
    outcome: "success",
    name: "M. Okonkwo & P. Okonkwo",
    savings: "$24,610.08",
    checking: "$3,104.55",
    status: "Active",
    relationship: "Joint — or / survivor",
  },
  {
    id: "33440",
    ticket: "Q-016",
    label: "New member",
    reason: "Welcome / zero balance",
    teller: "S. Patel opened yesterday. Shares are funded after ACH.",
    analyst: "Success with a $0.00 extract — empty is still a business result.",
    outcome: "success",
    name: "S. Patel",
    savings: "$0.00",
    status: "New",
    relationship: "Primary",
    flag: "Welcome kit pending. Do not quote a payoff.",
  },
  {
    id: "44551",
    ticket: "Q-017",
    label: "Dormant share",
    reason: "Reactivation request",
    teller: "L. Berg has not posted since 2019. Core still shows the balance.",
    analyst: "Readable extract with a dormant flag — not a hard fail.",
    outcome: "success",
    name: "L. Berg",
    savings: "$3,208.40",
    status: "Dormant",
    relationship: "Primary",
    flag: "Dormant 7 years. Reactivation needs ID + recent mail.",
  },
  {
    id: "55667",
    ticket: "Q-018",
    label: "Thin savings",
    reason: "NSF / low-share review",
    teller: "R. Alvarez is overdrawn in checking and asking about shares.",
    analyst: "Small savings extract; checking is context only.",
    outcome: "success",
    name: "R. Alvarez",
    savings: "$42.11",
    checking: "-$186.20",
    status: "Active",
    relationship: "Primary",
    flag: "Checking NSF. Shares are available but thin.",
  },
  {
    id: "99001",
    ticket: "Q-019",
    label: "Custodial minor",
    reason: "Custodian withdrawal",
    teller: "H. Ito is withdrawing from K. Ito’s UTMA. Minor is not present.",
    analyst: "Success; teller must see the custodial relationship.",
    outcome: "success",
    name: "K. Ito",
    savings: "$890.00",
    status: "Active",
    relationship: "Custodial — H. Ito, custodian",
    flag: "Custodian ID required. Do not release to the minor.",
  },
  {
    id: "66778",
    ticket: "Q-020",
    label: "Fraud freeze",
    reason: "Card fraud / hold",
    teller: "C. Whitman reports a stolen debit card. Servicing is blocked.",
    analyst: "ACCOUNT_FROZEN is a business outcome, not a locator miss.",
    outcome: "ACCOUNT_FROZEN",
    name: "C. Whitman",
    status: "Frozen",
    flag: "Fraud desk ticket FR-4419. Supervisor only.",
  },
  {
    id: "77889",
    ticket: "Q-021",
    label: "Estate hold",
    reason: "Death notification",
    teller: "Family brought a death certificate for J. Cole.",
    analyst: "ESTATE_HOLD — do not extract a balance for a walk-up teller.",
    outcome: "ESTATE_HOLD",
    name: "Estate of J. Cole",
    status: "Estate hold",
    flag: "Letters testamentary required before any inquiry.",
  },
  {
    id: "88888",
    ticket: "Q-022",
    label: "Restricted record",
    reason: "BSA / permission",
    teller: "Record is restricted. Teller-07 cannot open it.",
    analyst: "PERMISSION_DENIED — same detector as a chaos permission header.",
    outcome: "PERMISSION_DENIED",
    name: "Restricted Record",
    status: "Restricted",
  },
  {
    id: "99999",
    ticket: "Q-023",
    label: "Not on file",
    reason: "Wrong member number",
    teller: "Member recited a number that is not on this core.",
    analyst: "MEMBER_NOT_FOUND after Look up.",
    outcome: "MEMBER_NOT_FOUND",
  },
  {
    id: "1010",
    ticket: "Q-024",
    label: "Bad member ID",
    reason: "Short / mistyped ID",
    teller: "Someone typed four digits from a debit card.",
    analyst: "VALIDATION_FAILED before the search runs.",
    outcome: "VALIDATION_FAILED",
  },
];

export const HANDS = [
  {
    id: "s1",
    action: "type",
    target: 'textbox "Member ID"',
    paramRef: "memberId",
    why: "Enter the member identifier into the lookup field",
  },
  {
    id: "s2",
    action: "click",
    target: 'button "Look up"',
    why: "Submit the member search",
  },
  {
    id: "s3",
    action: "extract",
    target: 'status "Savings balance"',
    outputName: "savingsBalance",
    why: "Read the current savings balance from the member record",
  },
] as const;

export const POLICY = {
  hosts: ["127.0.0.1"],
  routes: ["/", "/lookup", "/member"],
  actions: ["type", "click", "extract"],
  irreversible: "Confirm open stays gated",
  note: "Hosted demo replays this approved contract. Live Chromium and HITL stay on localhost.",
};

const annotateHands = (outcome: string) =>
  HANDS.map((hand) =>
    outcome === "success" || hand.id !== "s3"
      ? { ...hand, state: "ok" as const }
      : { ...hand, state: "blocked" as const, reason: outcome },
  );

const event = (why: string) => [{ at: "2026-09-17T00:00:00.000Z", kind: "step_ok" as const, why }];

export const recordedReplay = (memberId?: string) => {
  const id = memberId ?? "12345";
  const c = CASES.find((row) => row.id === id);
  if (!c) {
    return {
      schemaVersion: "1.0.0",
      runId: "evidence-replay-not-found",
      capabilityId: "lookup-savings-balance",
      status: "business_outcome",
      outcome: "MEMBER_NOT_FOUND",
      memberId: id,
      events: event("unknown member id — recorded as MEMBER_NOT_FOUND"),
      hands: annotateHands("MEMBER_NOT_FOUND"),
      policy: POLICY,
      driftWarnings: [],
      evidence: { screenshots: [] },
    };
  }
  if (c.outcome === "success") {
    return {
      schemaVersion: "1.0.0",
      runId: `evidence-replay-${c.id}`,
      capabilityId: "lookup-savings-balance",
      status: "success",
      memberId: c.id,
      outputs: { savingsBalance: c.savings, memberName: c.name },
      case: { label: c.label, teller: c.teller, analyst: c.analyst, status: c.status, relationship: c.relationship },
      events: event(`recorded ${c.label} extract`),
      hands: annotateHands("success"),
      policy: POLICY,
      driftWarnings: [],
      evidence: { screenshots: [] },
    };
  }
  return {
    schemaVersion: "1.0.0",
    runId: `evidence-replay-${c.id}`,
    capabilityId: "lookup-savings-balance",
    status: "business_outcome",
    outcome: c.outcome,
    memberId: c.id,
    case: { label: c.label, teller: c.teller, analyst: c.analyst, status: c.status },
    events: event(`recorded ${c.label} → ${c.outcome}`),
    hands: annotateHands(c.outcome),
    policy: POLICY,
    driftWarnings: [],
    evidence: { screenshots: [] },
  };
};
