import { serve } from "@hono/node-server";
import { createBankApp } from "@cur/bank";
import { loopbackPolicy, PolicyGuard, Session, WebAdapter } from "@cur/engine";

export const startBank = async () => {
  const started = await new Promise<{
    port: number;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = serve({ fetch: createBankApp().fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        port: info.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
  return {
    url: `http://127.0.0.1:${started.port}/`,
    port: started.port,
    close: started.close,
  };
};

export const makeAdapter = (port: number, chaos?: string) => {
  const policy = new PolicyGuard(loopbackPolicy(port));
  const adapter = new WebAdapter({
    policy,
    extraHeaders: chaos ? { "x-chaos": chaos } : undefined,
  });
  return { policy, adapter, session: new Session() };
};
