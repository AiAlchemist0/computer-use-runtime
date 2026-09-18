export type DemoCase = {
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

export const FALLBACK_CASES: DemoCase[] = [
  { id: "12345", ticket: "Q-014", label: "Known member", reason: "Payroll balance inquiry", teller: "A. Nguyen asks what posted after Thursday’s payroll.", analyst: "Happy-path extract of primary savings.", outcome: "success", name: "A. Nguyen", savings: "$1,842.17", status: "Active" },
  { id: "22222", ticket: "Q-015", label: "Joint household", reason: "Joint owner verification", teller: "M. Okonkwo and P. Okonkwo want both names on the printout.", analyst: "Same capability, larger balance, joint relationship.", outcome: "success", name: "M. Okonkwo & P. Okonkwo", savings: "$24,610.08", status: "Active" },
  { id: "33440", ticket: "Q-016", label: "New member", reason: "Welcome / zero balance", teller: "S. Patel opened yesterday. Shares are funded after ACH.", analyst: "Success with a $0.00 extract — empty is still a business result.", outcome: "success", name: "S. Patel", savings: "$0.00", status: "New" },
  { id: "44551", ticket: "Q-017", label: "Dormant share", reason: "Reactivation request", teller: "L. Berg has not posted since 2019. Core still shows the balance.", analyst: "Readable extract with a dormant flag — not a hard fail.", outcome: "success", name: "L. Berg", savings: "$3,208.40", status: "Dormant" },
  { id: "55667", ticket: "Q-018", label: "Thin savings", reason: "NSF / low-share review", teller: "R. Alvarez is overdrawn in checking and asking about shares.", analyst: "Small savings extract; checking is context only.", outcome: "success", name: "R. Alvarez", savings: "$42.11", status: "Active" },
  { id: "99001", ticket: "Q-019", label: "Custodial minor", reason: "Custodian withdrawal", teller: "H. Ito is withdrawing from K. Ito’s UTMA. Minor is not present.", analyst: "Success; teller must see the custodial relationship.", outcome: "success", name: "K. Ito", savings: "$890.00", status: "Active" },
  { id: "66778", ticket: "Q-020", label: "Fraud freeze", reason: "Card fraud / hold", teller: "C. Whitman reports a stolen debit card. Servicing is blocked.", analyst: "ACCOUNT_FROZEN is a business outcome, not a locator miss.", outcome: "ACCOUNT_FROZEN", name: "C. Whitman", status: "Frozen" },
  { id: "77889", ticket: "Q-021", label: "Estate hold", reason: "Death notification", teller: "Family brought a death certificate for J. Cole.", analyst: "ESTATE_HOLD — do not extract a balance for a walk-up teller.", outcome: "ESTATE_HOLD", name: "Estate of J. Cole", status: "Estate hold" },
  { id: "88888", ticket: "Q-022", label: "Restricted record", reason: "BSA / permission", teller: "Record is restricted. Teller-07 cannot open it.", analyst: "PERMISSION_DENIED — same detector as a chaos permission header.", outcome: "PERMISSION_DENIED", name: "Restricted Record", status: "Restricted" },
  { id: "99999", ticket: "Q-023", label: "Not on file", reason: "Wrong member number", teller: "Member recited a number that is not on this core.", analyst: "MEMBER_NOT_FOUND after Look up.", outcome: "MEMBER_NOT_FOUND" },
  { id: "1010", ticket: "Q-024", label: "Bad member ID", reason: "Short / mistyped ID", teller: "Someone typed four digits from a debit card.", analyst: "VALIDATION_FAILED before the search runs.", outcome: "VALIDATION_FAILED" },
];

export const readable = (cases: DemoCase[]) => cases.filter((c) => c.outcome === "success");
export const blocked = (cases: DemoCase[]) => cases.filter((c) => c.outcome !== "success");
