import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { CASES, findMember, getSession, type ChaosKind } from "./store.js";
import { layout, searchPage, resultPage, panePage, confirmPage, notice } from "./pages.js";

const queue = () => CASES.map((c) => ({ ticket: c.ticket, id: c.id, reason: c.reason }));
const lookup = (error?: string) => searchPage(error, queue());

export type BankEnv = {
  Variables: { sid: string; chaos: ChaosKind };
};

const CHAOS: ChaosKind[] = [
  "none",
  "timeout",
  "dialog",
  "permission",
  "expired",
  "validation",
  "slow",
  "not_found",
];

const parseChaos = (raw: string | undefined): ChaosKind =>
  CHAOS.includes(raw as ChaosKind) ? (raw as ChaosKind) : "none";

export const createBankApp = () => {
  const app = new Hono<BankEnv>();

  app.use("*", async (c, next) => {
    const headerChaos = parseChaos(c.req.header("x-chaos"));
    const cookieChaos = parseChaos(getCookie(c, "chaos"));
    const chaos = headerChaos !== "none" ? headerChaos : cookieChaos;
    const sid = getCookie(c, "sid") ?? getSession(undefined, chaos).id;
    getSession(sid, chaos);
    setCookie(c, "sid", sid, { path: "/", httpOnly: true });
    if (chaos !== "none") setCookie(c, "chaos", chaos, { path: "/", httpOnly: true });
    c.set("sid", sid);
    c.set("chaos", chaos);
    if (chaos === "slow") await sleep(2200);
    await next();
  });

  app.get("/", (c) => {
    if (c.get("chaos") === "dialog") {
      return c.html(layout("Notice", notice("System maintenance window.", true) + lookup()));
    }
    return c.html(layout("Member lookup", lookup()));
  });

  app.post("/lookup", async (c) => {
    const body = await c.req.parseBody();
    const memberId = String(body.memberId ?? "").trim();
    const chaos = c.get("chaos");
    const session = getSession(c.get("sid"), chaos);

    if (chaos === "timeout") {
      return c.html(layout("Timeout", notice("The core is not responding. Try again later.")));
    }
    if (chaos === "expired") {
      return c.html(layout("Expired", notice("Session expired. Sign in again.")));
    }
    if (chaos === "validation" || !/^\d{5}$/.test(memberId)) {
      return c.html(layout("Lookup", lookup("Member ID must be 5 digits.")));
    }
    if (chaos === "not_found") {
      return c.html(layout("Lookup", lookup("No such member.")));
    }
    const member = findMember(memberId);
    if (!member) {
      return c.html(layout("Lookup", lookup("No such member.")));
    }
    if (chaos === "permission" || member.restricted || member.block) {
      return c.html(layout("Lookup", lookup(member.block?.message ?? "Permission denied.")));
    }
    session.opened.add(member.id);
    return c.redirect(`/member/${member.id}`);
  });

  app.get("/member/:id", (c) => {
    const member = findMember(c.req.param("id"));
    if (!member) return c.html(layout("Lookup", lookup("No such member.")));
    if (c.get("chaos") === "permission" || member.restricted || member.block) {
      return c.html(layout("Lookup", lookup(member.block?.message ?? "Permission denied.")));
    }
    return c.html(layout(`Member ${member.id}`, resultPage(member)));
  });

  app.get("/member/:id/pane", (c) => {
    const member = findMember(c.req.param("id"));
    if (!member)
      return c.html(
        panePage({
          id: "00000",
          name: "Unknown",
          savings: "—",
          relationship: "—",
          product: "—",
          branch: "—",
          opened: "—",
          lastSeen: "—",
          status: "—",
          scenario: "Unknown",
        }),
      );
    return c.html(panePage(member));
  });

  app.post("/member/:id/sub-account", (c) => {
    const member = findMember(c.req.param("id"));
    if (!member) return c.html(layout("Lookup", lookup("No such member.")));
    return c.html(layout("Confirm sub-account", confirmPage(member)));
  });

  app.post("/member/:id/sub-account/confirm", (c) => {
    const member = findMember(c.req.param("id"));
    if (!member) return c.html(layout("Lookup", lookup("No such member.")));
    getSession(c.get("sid")).opened.add(`sub-${member.id}`);
    return c.html(layout("Confirmed", notice(`Sub-account opened for member ${member.id}.`)));
  });

  return app;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
