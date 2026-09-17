import type { Member } from "./store.js";

export const layout = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Times New Roman", serif; background: #e8e4d9; margin: 0; }
    table.shell { width: 100%; border-collapse: collapse; }
    td.nav { width: 180px; background: #3d4a3a; color: #fff; vertical-align: top; padding: 16px; }
    td.main { padding: 20px; }
    table.grid { border-collapse: collapse; width: 100%; }
    table.grid td, table.grid th { border: 1px solid #777; padding: 6px 10px; }
    input, button { font: inherit; }
    .alert { color: #7a1f1f; font-weight: bold; }
  </style>
</head>
<body>
  <table class="shell">
    <tr>
      <td class="nav">MockCore<br/>Servicing</td>
      <td class="main">${body}</td>
    </tr>
  </table>
</body>
</html>`;

export const searchPage = (error?: string) => `
  <h1>Member lookup</h1>
  <p>Enter a five-digit member number.</p>
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
`;

export const resultPage = (member: Member) => `
  <h1>Member ${escapeHtml(member.id)}</h1>
  <p>${escapeHtml(member.name)}</p>
  <h2>Savings balance</h2>
  <p><span role="status" aria-label="Savings balance">${escapeHtml(member.savings)}</span></p>
  <iframe title="Account pane" src="/member/${escapeHtml(member.id)}/pane" width="100%" height="160"></iframe>
  <form method="post" action="/member/${escapeHtml(member.id)}/sub-account">
    <p><button type="submit">Open sub-account</button></p>
  </form>
  <p><a href="/">Back to lookup</a></p>
`;

export const panePage = (member: Member) => `<!doctype html>
<html lang="en"><body style="font-family: Times New Roman, serif; margin: 8px;">
  <table class="grid" style="border-collapse:collapse;width:100%">
    <tr><th>Account</th><th>Balance</th></tr>
    <tr>
      <td>Savings</td>
      <td><span role="status" aria-label="Savings balance">${escapeHtml(member.savings)}</span></td>
    </tr>
  </table>
</body></html>`;

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
