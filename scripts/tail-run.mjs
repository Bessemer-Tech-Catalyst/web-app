#!/usr/bin/env node
/**
 * Print a run's event log as one legible line per event.
 *
 * `node scripts/tail-run.mjs <runId> [--from N] [--root DIR]` — the demo's flight
 * recorder in the terminal, for when the console is not the surface being watched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const runId = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
if (!runId) {
  console.error("usage: node scripts/tail-run.mjs <runId> [--from N] [--root DIR]");
  process.exit(2);
}
const root = flag("root", process.cwd());
const from = Number(flag("from", 0));
const file = join(root, ".odyssey", "runs", runId, "events.ndjson");

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const text = (e) =>
  e.type === "decision"
    ? `${e.action}${e.confidence == null ? "" : ` (${e.confidence})`}`
    : e.type === "stage.entered"
      ? `→ ${e.stage}${e.attempt > 1 ? ` attempt ${e.attempt}` : ""}`
      : e.type === "stage.exited"
        ? `← ${e.stage} ${e.outcome} ${Math.round((e.durationMs ?? 0) / 100) / 10}s`
        : e.type === "cost"
          ? `$${(e.usd ?? 0).toFixed(4)}`
          : (e.summary ?? e.text ?? e.message ?? e.title ?? e.name ?? "");

for (const [i, line] of lines.entries()) {
  if (i < from) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const who = e.stage ?? e.agent ?? "";
  console.log(`${String(i).padStart(4)} ${e.type.padEnd(16)} ${String(who).padEnd(10)} ${String(text(e)).slice(0, 160)}`);
}
console.log(`--- ${lines.length} events`);
