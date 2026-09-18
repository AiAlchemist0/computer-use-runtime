import { randomUUID } from "node:crypto";
import { CASES, type DemoCase } from "./cases.js";

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
  checking?: string;
  moneyMarket?: string;
  relationship: string;
  product: string;
  branch: string;
  opened: string;
  lastSeen: string;
  status: string;
  flag?: string;
  restricted?: boolean;
  block?: { code: string; message: string };
  scenario: string;
};

const toMember = (c: DemoCase): Member | undefined => {
  if (!c.name || !c.savings) return undefined;
  return {
    id: c.id,
    name: c.name,
    savings: c.savings,
    checking: c.checking,
    moneyMarket: c.moneyMarket,
    relationship: c.relationship ?? "Primary",
    product: c.product ?? "Regular shares",
    branch: c.branch ?? "014 · Harbor",
    opened: c.opened ?? "—",
    lastSeen: c.lastSeen ?? "—",
    status: c.status ?? "Active",
    flag: c.flag,
    restricted: c.outcome === "PERMISSION_DENIED",
    block: c.blockMessage ? { code: c.outcome, message: c.blockMessage } : undefined,
    scenario: c.label,
  };
};

export const MEMBERS: Member[] = CASES.map(toMember).filter((m): m is Member => Boolean(m));

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

export { CASES, findCase } from "./cases.js";
