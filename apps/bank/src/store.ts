import { randomUUID } from "node:crypto";

export type ChaosKind =
  | "none"
  | "timeout"
  | "dialog"
  | "permission"
  | "expired"
  | "validation"
  | "slow"
  | "not_found";

export type Member = {
  id: string;
  name: string;
  savings: string;
  restricted?: boolean;
};

export const MEMBERS: Member[] = [
  { id: "12345", name: "A. Nguyen", savings: "$1,842.17" },
  { id: "88888", name: "Restricted Record", savings: "$9.00", restricted: true },
];

export type BankSession = {
  id: string;
  chaos: ChaosKind;
  opened: Set<string>;
};

const sessions = new Map<string, BankSession>();

export const getSession = (id?: string, chaos: ChaosKind = "none"): BankSession => {
  if (id && sessions.has(id)) {
    const s = sessions.get(id)!;
    if (chaos !== "none") s.chaos = chaos;
    return s;
  }
  const created: BankSession = { id: id ?? randomUUID(), chaos, opened: new Set() };
  sessions.set(created.id, created);
  return created;
};

export const resetSession = (id: string) => {
  sessions.delete(id);
};

export const findMember = (id: string): Member | undefined => MEMBERS.find((m) => m.id === id);
