/**
 * The append-only event log — the source of truth for a run.
 *
 * Run state is a left-fold over this file (`reduceRun`), which buys us, from one
 * primitive: SSE replay, crash recovery, time-travel scrubbing and offline demo
 * replay. Nothing else persists run state.
 */

import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { OrchestratorEvent } from "@/lib/types";

/**
 * Appends are serialised per file. Node's `appendFile` is not atomic across
 * concurrent calls, and a torn line would corrupt the log we recover from.
 */
const queues = new Map<string, Promise<void>>();

export async function appendEvent(file: string, event: OrchestratorEvent) {
  const line = JSON.stringify(event) + "\n";
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, line, "utf8");
    });
  queues.set(file, next);
  return next;
}

/** Reads the log back, skipping any half-written trailing line from a crash. */
export async function readEvents(
  file: string,
  fromSeq = 0,
): Promise<OrchestratorEvent[]> {
  const out: OrchestratorEvent[] = [];
  let stream;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
  } catch {
    return out;
  }
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as OrchestratorEvent;
        if (ev.seq >= fromSeq) out.push(ev);
      } catch {
        // Truncated final line — the process died mid-append. Everything before it stands.
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return out;
}

/**
 * Credentials reach us in `RunInput` and must never land in a file we replay,
 * ship in a report, or paste into a bug. Redaction happens on the write path, so
 * a leak is impossible downstream rather than merely unlikely.
 */
export function redact<T>(value: T, secrets: string[]): T {
  const live = secrets.filter((s) => s && s.length >= 3);
  if (live.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return live.reduce((acc, s) => acc.split(s).join("«redacted»"), v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return walk(value) as T;
}
