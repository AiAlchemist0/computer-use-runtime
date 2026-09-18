import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Capability, type RunResult } from "@cur/schema";
import type { Store } from "./interfaces.js";

export class FileStore implements Store {
  constructor(readonly root: string) {}

  async writeCapability(id: string, cap: Capability): Promise<void> {
    const dir = join(this.root, "capabilities");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(cap, null, 2)}\n`);
  }

  async readCapability(id: string): Promise<Capability | null> {
    const p = join(this.root, "capabilities", `${id}.json`);
    if (!existsSync(p)) return null;
    return Capability.parse(JSON.parse(readFileSync(p, "utf8")));
  }

  async writeRun(dir: string, name: string, data: unknown): Promise<string> {
    const full = join(this.root, dir);
    mkdirSync(full, { recursive: true });
    const path = join(full, name);
    writeFileSync(path, typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`);
    return path;
  }

  async writeBinary(dir: string, name: string, data: Buffer): Promise<string> {
    const full = join(this.root, dir);
    mkdirSync(full, { recursive: true });
    const path = join(full, name);
    writeFileSync(path, data);
    return path;
  }

  async writeResult(dir: string, result: RunResult): Promise<string> {
    return this.writeRun(dir, "result.json", result);
  }
}
