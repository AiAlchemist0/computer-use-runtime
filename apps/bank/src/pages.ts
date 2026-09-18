import type { Member } from "./store.js";

const chrome = `
  :root { --ink:#1c1914; --paper:#f3ead6; --field:#fffdf6; --line:#8a7a55; --nav:#24362c; --brass:#c4a35a; --alert:#7a1f1f; }
  html, body { margin: 0; background: #cfc4a8; color: var(--ink); font-family: "Times New Roman", Times, serif; }
  table.shell { width: 100%; border-collapse: collapse; min-height: 100vh; }
  td.nav { width: 200px; background: var(--nav); color: #f4efe4; vertical-align: top; padding: 0; }
  td.main { padding: 0; background: var(--paper); }
  .brand { padding: 18px 16px 12px; border-bottom: 3px solid var(--brass); }
  .brand strong { display: block; font-size: 18px; letter-spacing: 0.04em; }
  .brand span { font-size: 12px; opacity: 0.85; }
  .navlist { padding: 16px; font-size: 14px; line-height: 1.8; }
  .topbar { display: table; width: 100%; background: #2d4638; color: #f4efe4; font-size: 12px; }
  .topbar span { display: table-cell; padding: 8px 16px; }
  .topbar .right { text-align: right; }
  .work { padding: 22px 24px 40px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 20px 0 8px; }
  table.grid { border-collapse: collapse; width: 100%; background: var(--field); }
  table.grid td, table.grid th { border: 1px solid var(--line); padding: 8px 12px; text-align: left; }
  input, button { font: inherit; }
  input { padding: 4px 8px; border: 1px solid var(--line); background: #fff; min-width: 160px; }
  button { padding: 6px 14px; background: #e8d9a8; border: 1px solid #6d5c2e; cursor: pointer; }
  button:hover { background: #f3e6b8; }
  .alert { color: var(--alert); font-weight: bold; }
  .meta { color: #5c5344; font-size: 14px; margin: 0 0 16px; }
  .footer { padding: 10px 16px; border-top: 1px solid #b7aa86; font-size: 11px; color: #5c5344; }
`;

export const layout = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${chrome}</style>
</head>
<body>
  <table class="shell">
    <tr>
      <td class="nav">
        <div class="brand"><strong>MockCore</strong><span>Credit Union · Servicing</span></div>
        <div class="navlist">
          Member lookup<br/>
          Account pane<br/>
          Sub-accounts<br/>
          Nightly batch
        </div>
      </td>
      <td class="main">
        <div class="topbar">
          <span>Branch 014 · Operator TELLER-07</span>
          <span class="right">Internal use only · Session on 127.0.0.1</span>
        </div>
        <div class="work">${body}</div>
        <div class="footer">MockCore v4.2 — no test IDs, table layout, full-page posts. This is the teller screen a member record lives behind.</div>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const searchPage = (error?: string, queue: { ticket: string; id: string; reason: string }[] = []) => `
  <h1>Member lookup</h1>
  <p class="meta">Enter a five-digit member number. This is the branch servicing screen — not online banking.</p>
  ${error ? `<p class="alert" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/lookup">
    <table class="grid">
      <tr>
        <td><label>Member ID</label></td>
        <td><input name="memberId" aria-label="Member ID" /></td>
      </tr>
    </table>
    <p><button type="submit">Look up</button></p>
  </form>
  ${
    queue.length
      ? `<h2>Today’s branch queue</h2>
  <p class="meta">Walk-ins for TELLER-07. Type the member number above — this list is not a control.</p>
  <table class="grid">
    <tr><th>Ticket</th><th>Member</th><th>Reason</th></tr>
    ${queue
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.ticket)}</td><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.reason)}</td></tr>`,
      )
      .join("")}
  </table>`
      : ""
  }
`;

export const resultPage = (member: Member) => `
  <h1>Member ${escapeHtml(member.id)}</h1>
  <p class="meta">${escapeHtml(member.name)} · ${escapeHtml(member.relationship)} · ${escapeHtml(member.scenario)}</p>
  <table class="grid">
    <tr><td>Status</td><td>${escapeHtml(member.status)}</td></tr>
    <tr><td>Product</td><td>${escapeHtml(member.product)}</td></tr>
    <tr><td>Branch</td><td>${escapeHtml(member.branch)}</td></tr>
    <tr><td>Opened / last seen</td><td>${escapeHtml(member.opened)} / ${escapeHtml(member.lastSeen)}</td></tr>
  </table>
  ${member.flag ? `<p class="alert" role="note">${escapeHtml(member.flag)}</p>` : ""}
  <h2>Savings balance</h2>
  <p><span role="status" aria-label="Savings balance">${escapeHtml(member.savings)}</span></p>
  <iframe title="Account pane" src="/member/${escapeHtml(member.id)}/pane" width="100%" height="180"></iframe>
  <form method="post" action="/member/${escapeHtml(member.id)}/sub-account">
    <p><button type="submit">Open sub-account</button></p>
  </form>
  <p><a href="/">Back to lookup</a></p>
`;

export const panePage = (member: Member) => {
  const extra = [
    member.checking ? `<tr><td style="border:1px solid #8a7a55;padding:8px 12px">Checking</td><td style="border:1px solid #8a7a55;padding:8px 12px">${escapeHtml(member.checking)}</td></tr>` : "",
    member.moneyMarket ? `<tr><td style="border:1px solid #8a7a55;padding:8px 12px">Money market</td><td style="border:1px solid #8a7a55;padding:8px 12px">${escapeHtml(member.moneyMarket)}</td></tr>` : "",
  ].join("");
  return `<!doctype html>
<html lang="en"><body style="font-family: Times New Roman, serif; margin: 8px; background:#fffdf6; color:#1c1914;">
  <table class="grid" style="border-collapse:collapse;width:100%;background:#fffdf6">
    <tr><th style="border:1px solid #8a7a55;padding:8px 12px;text-align:left">Account</th><th style="border:1px solid #8a7a55;padding:8px 12px;text-align:left">Balance</th></tr>
    <tr>
      <td style="border:1px solid #8a7a55;padding:8px 12px">Savings</td>
      <td style="border:1px solid #8a7a55;padding:8px 12px"><span role="status" aria-label="Savings balance">${escapeHtml(member.savings)}</span></td>
    </tr>
    ${extra}
  </table>
</body></html>`;
};

export const confirmPage = (member: Member) => `
  <h1>Confirm sub-account</h1>
  <p>Open a new savings sub-account for member ${escapeHtml(member.id)}? This cannot be undone.</p>
  <form method="post" action="/member/${escapeHtml(member.id)}/sub-account/confirm">
    <button type="submit">Confirm open</button>
  </form>
`;

export const notice = (text: string, dismissable = false) => `
  <p class="alert" role="alert">${escapeHtml(text)}</p>
  ${dismissable ? `<form method="get" action="/"><button type="submit">Dismiss notice</button></form>` : ""}
`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
