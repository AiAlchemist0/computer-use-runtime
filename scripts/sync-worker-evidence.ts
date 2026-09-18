/**
 * Copy the committed /evidence pack into apps/worker/public/evidence so the hosted
 * briefing can show recorded discovery, replay, HITL, and stability without a browser.
 * Writes manifest.json describing each run. Chromium is never involved.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const src = join(root, "evidence");
const dst = join(root, "apps", "worker", "public", "evidence");

type Run = {
  dir: string;
  kind: "discovery" | "replay" | "hitl" | "capability" | "stability";
  label: string;
  status?: string;
  outcome?: string;
  failureCode?: string;
  modelId?: string;
  files: string[];
};

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

const readJson = <T>(p: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return undefined;
  }
};

if (!existsSync(src)) throw new Error("evidence/ not found; run pnpm evidence first");
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });

const runs: Run[] = [];
for (const name of readdirSync(src)) {
  const p = join(src, name);
  if (!statSync(p).isDirectory()) {
    if (name === "stability.json") runs.push({ dir: name, kind: "stability", label: "Multi-run stability", files: [name] });
    continue;
  }
  const files = walk(p).map((f) => relative(src, f).replace(/\\/g, "/"));
  if (name === "capabilities") {
    runs.push({ dir: name, kind: "capability", label: "Replayable capability", files });
    continue;
  }
  if (name.startsWith("discovery-")) {
    const cap = readJson<{ status?: string; provenance?: { modelId?: string } }>(join(p, "capability.json"));
    runs.push({
      dir: name,
      kind: "discovery",
      label: cap?.provenance?.modelId?.startsWith("fake") ? "Compiled discovery (scripted tools)" : `Live discovery (${cap?.provenance?.modelId ?? "provider"})`,
      status: cap?.status,
      modelId: cap?.provenance?.modelId,
      files,
    });
    continue;
  }
  const result = readJson<{ status?: string; outcome?: string; failure?: { code?: string } }>(join(p, "result.json"));
  runs.push({
    dir: name,
    kind: name === "hitl-local" ? "hitl" : "replay",
    label:
      name === "hitl-local"
        ? "HITL same-session handoff"
        : name.replace(/^replay-/, "").replace(/-\d+$/, "").replace(/-/g, " "),
    status: result?.status,
    outcome: result?.outcome,
    failureCode: result?.failure?.code,
    files,
  });
}

writeFileSync(join(dst, "manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2)}\n`);
console.log(`synced ${runs.length} evidence entries to apps/worker/public/evidence`);
