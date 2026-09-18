import type {
  ActionType,
  Capability,
  CapabilityStep,
  Checkpoint,
  LocatorChain,
  Parameter,
  RunResult,
} from "@cur/schema";

export type ObserveResult = {
  url: string;
  title: string;
  aria: string;
  screenshotPng?: Buffer;
};

export type ActRequest = {
  action: ActionType;
  target?: LocatorChain;
  value?: string;
};

export type ExtractResult = { text: string };

export type HumanPointer = {
  nx: number;
  ny: number;
  viewport: { width: number; height: number };
};

export interface SurfaceAdapter {
  observe(opts?: { screenshot?: boolean }): Promise<ObserveResult>;
  resolve(chain: LocatorChain): Promise<{ count: number; handleOk: boolean }>;
  act(req: ActRequest): Promise<void>;
  extract(chain: LocatorChain): Promise<ExtractResult>;
  screenshot(opts?: {
    mask?: LocatorChain[];
    values?: Record<string, string>;
    parameters?: Parameter[];
    steps?: CapabilityStep[];
  }): Promise<Buffer>;
  waitFor(kind: "url" | "element" | "text" | "load", value?: string, timeoutMs?: number): Promise<void>;
  pause(): Promise<void>;
  injectHumanInput(kind: "click" | "type" | "press", payload: HumanPointer | { text?: string; key?: string }): Promise<void>;
  elementAtPoint(nx: number, ny: number, viewport: { width: number; height: number }): Promise<LocatorChain | null>;
  url(): Promise<string>;
  assertCheckpoint(cp: Checkpoint): Promise<boolean>;
  close(): Promise<void>;
}

export type ControlOwner = "agent" | "human";

export interface SessionControl {
  id: string;
  controlOwner: ControlOwner;
  setOwner(owner: ControlOwner): void;
  assertAgent(): void;
}

export interface Store {
  writeCapability(id: string, cap: Capability): Promise<void>;
  readCapability(id: string): Promise<Capability | null>;
  writeRun(dir: string, name: string, data: unknown): Promise<string>;
  writeBinary(dir: string, name: string, data: Buffer): Promise<string>;
  writeResult(dir: string, result: RunResult): Promise<string>;
}
