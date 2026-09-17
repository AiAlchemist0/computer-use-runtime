import { serve } from "@hono/node-server";
import { createBankApp } from "./app.js";

const port = Number(process.env.BANK_PORT ?? 4177);
serve({ fetch: createBankApp().fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`mock bank http://127.0.0.1:${info.port}`);
});
