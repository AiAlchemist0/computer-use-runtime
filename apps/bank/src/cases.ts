export type OutcomeCode =
  | "success"
  | "MEMBER_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "ACCOUNT_FROZEN"
  | "ESTATE_HOLD"
  | "VALIDATION_FAILED";

export type DemoCase = {
  id: string;
  ticket: string;
  label: string;
  reason: string;
  teller: string;
  analyst: string;
  outcome: OutcomeCode;
  name?: string;
  savings?: string;
  checking?: string;
  moneyMarket?: string;
  relationship?: string;
  product?: string;
  branch?: string;
  opened?: string;
  lastSeen?: string;
  status?: string;
  flag?: string;
  blockMessage?: string;
};

export const CASES: DemoCase[] = [
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
    relationship: "Primary",
    product: "Regular shares",
    branch: "014 · Harbor",
    opened: "2019-03-12",
    lastSeen: "2026-09-16",
    status: "Active",
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
    moneyMarket: "$18,200.00",
    relationship: "Joint — or / survivor",
    product: "Household share + MM",
    branch: "014 · Harbor",
    opened: "2014-07-01",
    lastSeen: "2026-09-10",
    status: "Active",
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
    checking: "$0.00",
    relationship: "Primary",
    product: "Starter shares",
    branch: "021 · Midtown",
    opened: "2026-09-16",
    lastSeen: "2026-09-16",
    status: "New",
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
    relationship: "Primary",
    product: "Regular shares",
    branch: "008 · Westgate",
    opened: "2008-11-04",
    lastSeen: "2019-02-18",
    status: "Dormant",
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
    relationship: "Primary",
    product: "Share draft + shares",
    branch: "014 · Harbor",
    opened: "2021-06-30",
    lastSeen: "2026-09-15",
    status: "Active",
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
    relationship: "Custodial — H. Ito, custodian",
    product: "UTMA shares",
    branch: "021 · Midtown",
    opened: "2020-01-09",
    lastSeen: "2026-08-02",
    status: "Active",
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
    savings: "$6,441.90",
    relationship: "Primary",
    product: "Regular shares",
    branch: "014 · Harbor",
    opened: "2017-04-22",
    lastSeen: "2026-09-17",
    status: "Frozen",
    blockMessage: "Account is frozen.",
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
    savings: "$11,075.00",
    relationship: "Estate",
    product: "Regular shares",
    branch: "008 · Westgate",
    opened: "2003-09-18",
    lastSeen: "2026-07-11",
    status: "Estate hold",
    blockMessage: "Estate hold — supervisor required.",
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
    savings: "$9.00",
    relationship: "Restricted",
    product: "Internal hold",
    branch: "000 · Secure",
    opened: "2022-01-01",
    lastSeen: "2026-01-01",
    status: "Restricted",
    blockMessage: "Permission denied.",
    flag: "BSA queue. Do not read balances aloud.",
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

export const findCase = (id: string) => CASES.find((c) => c.id === id);
