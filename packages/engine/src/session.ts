import { randomUUID } from "node:crypto";
import type { ControlOwner, SessionControl } from "./interfaces.js";

export type SessionTimerKind = "ok" | "escalation_timed_out" | "human_idle";

export type SessionOptions = {
  id?: string;
  /** Unanswered intervention window. Default 4 minutes. */
  unansweredMs?: number;
  /** Idle after last human action. Default 4 minutes. */
  idleMs?: number;
};

export class Session implements SessionControl {
  readonly id: string;
  controlOwner: ControlOwner = "agent";
  interventionStartedAt?: number;
  lastHumanAt?: number;
  humanActed = false;
  readonly unansweredMs: number;
  readonly idleMs: number;

  constructor(idOrOpts?: string | SessionOptions) {
    const opts = typeof idOrOpts === "string" ? { id: idOrOpts } : (idOrOpts ?? {});
    this.id = opts.id ?? randomUUID();
    this.unansweredMs = opts.unansweredMs ?? 4 * 60_000;
    this.idleMs = opts.idleMs ?? 4 * 60_000;
  }

  setOwner(owner: ControlOwner): void {
    this.controlOwner = owner;
    if (owner === "human") {
      this.interventionStartedAt = Date.now();
      this.lastHumanAt = Date.now();
      this.humanActed = false;
    }
  }

  recordHuman(): void {
    this.lastHumanAt = Date.now();
    this.humanActed = true;
  }

  checkTimers(now = Date.now()): SessionTimerKind {
    if (this.controlOwner !== "human") return "ok";
    if (!this.humanActed && this.interventionStartedAt && now - this.interventionStartedAt > this.unansweredMs) {
      return "escalation_timed_out";
    }
    if (this.humanActed && this.lastHumanAt && now - this.lastHumanAt > this.idleMs) {
      return "human_idle";
    }
    return "ok";
  }

  releaseIfTimedOut(now = Date.now()): SessionTimerKind {
    const kind = this.checkTimers(now);
    if (kind !== "ok") this.controlOwner = "agent";
    return kind;
  }

  assertAgent(): void {
    if (this.controlOwner !== "agent") {
      throw new Error("session is owned by human; agent actions blocked");
    }
  }
}
