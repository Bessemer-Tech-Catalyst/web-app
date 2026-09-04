/**
 * The run registry: creates runs, drives them, persists them, and fans their events
 * out to every connected client.
 *
 * There is no database. A run is a directory; its state is a fold over its event log.
 * This module holds the in-process half of that — the live emitter and the index — and
 * falls back to the files whenever memory does not have the answer (a finished run, a
 * run from before the last restart, a reload mid-stream).
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { appendEvent, readEvents, redact } from "./event-log";
import { runOrchestrator } from "./orchestrator/run";
import { DATA_DIR, INDEX_FILE, eventsFile, isValidRunId, runPath } from "./paths";
import { scaffoldWorkspace } from "./workspace";
import {
  emptyRunState,
  reduceRun,
  type OrchestratorEvent,
  type OrchestratorEventInit,
  type RunInput,
  type RunState,
  type RunStatus,
} from "@/lib/types";

export interface RunIndexEntry {
  id: string;
  url: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  intent?: string;
  durationMs: number;
  scenarios: number;
  passed: number;
  failed: number;
  healed: number;
  bugs: number;
  replans: number;
  coverageScore: number;
  costUsd: number;
}

type Listener = (event: OrchestratorEvent) => void;

interface LiveRun {
  id: string;
  input: RunInput;
  status: RunStatus;
  seq: number;
  /** Kept in memory so a reconnecting client is served without touching the disk. */
  events: OrchestratorEvent[];
  listeners: Set<Listener>;
  controller: AbortController;
  secrets: string[];
}

/**
 * Survives HMR. Without this, editing any server file mid-run would orphan the
 * orchestrator and strand every open SSE connection.
 */
const g = globalThis as unknown as { __odyssey?: { runs: Map<string, LiveRun> } };
const store = (g.__odyssey ??= { runs: new Map<string, LiveRun>() });

const newRunId = () => `run_${randomBytes(4).toString("hex")}`;

// ---------------------------------------------------------------------------
// Creating and driving a run
// ---------------------------------------------------------------------------

export async function createRun(input: RunInput): Promise<{ id: string }> {
  const id = newRunId();
  await scaffoldWorkspace(id, input);

  const run: LiveRun = {
    id,
    input,
    status: "running",
    seq: 0,
    events: [],
    listeners: new Set(),
    controller: new AbortController(),
    secrets: input.credentials ? [input.credentials.password] : [],
  };
  store.runs.set(id, run);

  await upsertIndex({
    id,
    url: input.url,
    status: "running",
    startedAt: new Date().toISOString(),
    intent: input.intent,
    durationMs: 0,
    scenarios: 0,
    passed: 0,
    failed: 0,
    healed: 0,
    bugs: 0,
    replans: 0,
    coverageScore: 0,
    costUsd: 0,
  });

  // Fire and forget: the HTTP response returns immediately and the client follows
  // the run over SSE. Nothing about the run's progress depends on that connection.
  void drive(run);

  return { id };
}

async function drive(run: LiveRun) {
  const emit = (init: OrchestratorEventInit) => publish(run, init);
  try {
    run.status = await runOrchestrator({
      runId: run.id,
      input: run.input,
      emit,
      signal: run.controller.signal,
    });
  } catch (err) {
    if (run.controller.signal.aborted) {
      run.status = "cancelled";
      publish(run, {
        type: "error",
        stage: "report",
        message: "Run cancelled",
        recoverable: false,
        terminal: "cancelled",
      });
    } else {
      run.status = "failed";
      publish(run, {
        type: "error",
        stage: "report",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
        terminal: "failed",
      });
    }
  } finally {
    await finalise(run);
    // Close every open stream, then let the run age out of memory. The files stay.
    for (const listener of run.listeners) listener(TERMINATOR);
  }
}

/** A sentinel the SSE route recognises as "the run is over, close the stream". */
export const TERMINATOR = {
  type: "stream.end",
} as unknown as OrchestratorEvent;

function publish(run: LiveRun, init: OrchestratorEventInit): OrchestratorEvent {
  const event = redact(
    { ...init, seq: run.seq++, ts: new Date().toISOString() } as OrchestratorEvent,
    run.secrets,
  );
  run.events.push(event);
  // Persistence is the source of truth, but it must never block the live stream —
  // a slow disk should not stall the console. Failures surface on the read path.
  void appendEvent(eventsFile(run.id), event);
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // A dead connection must not take the run down with it.
    }
  }
  return event;
}

async function finalise(run: LiveRun) {
  const state = run.events.reduce(reduceRun, emptyRunState());
  const report = state.report;
  await upsertIndex({
    id: run.id,
    url: run.input.url,
    status: run.status,
    startedAt: report?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    intent: run.input.intent,
    durationMs: report?.durationMs ?? 0,
    scenarios: report?.scenariosPlanned ?? state.scenarios.length,
    passed: report?.passed ?? 0,
    failed: report?.failed ?? 0,
    healed: report?.healed ?? 0,
    bugs: report?.bugs.length ?? state.bugs.length,
    replans: report?.replans ?? 0,
    coverageScore: report?.coverageScore ?? 0,
    costUsd: report?.costUsd ?? state.costUsd,
  });
}

export function cancelRun(id: string): boolean {
  const run = store.runs.get(id);
  if (!run || run.status !== "running") return false;
  run.controller.abort(new Error("cancelled"));
  return true;
}

// ---------------------------------------------------------------------------
// Reading a run
// ---------------------------------------------------------------------------

export function isLive(id: string): boolean {
  return store.runs.get(id)?.status === "running";
}

/**
 * History then live tail, with no gap and no duplicates.
 *
 * Subscribing *before* reading history is what closes the race: anything emitted
 * while we read the log is buffered, and the seq watermark discards whatever the
 * history already covered.
 */
export async function subscribe(
  id: string,
  fromSeq: number,
  listener: Listener,
): Promise<() => void> {
  const run = store.runs.get(id);
  let unsubscribe = () => {};
  const buffered: OrchestratorEvent[] = [];
  let replaying = true;

  if (run) {
    const buffer: Listener = (ev) => (replaying ? buffered.push(ev) : listener(ev));
    run.listeners.add(buffer);
    unsubscribe = () => run.listeners.delete(buffer);
  }

  const history = run?.events.length
    ? run.events.filter((e) => e.seq >= fromSeq)
    : await readEvents(eventsFile(id), fromSeq);

  let watermark = fromSeq - 1;
  for (const ev of history) {
    listener(ev);
    watermark = ev.seq;
  }

  replaying = false;
  for (const ev of buffered) {
    if (ev.seq > watermark) listener(ev);
  }

  // Nothing is driving this run — it finished, or it predates the last restart.
  if (!run || run.status !== "running") listener(TERMINATOR);

  return unsubscribe;
}

export async function getEvents(id: string, fromSeq = 0): Promise<OrchestratorEvent[]> {
  const run = store.runs.get(id);
  if (run?.events.length) return run.events.filter((e) => e.seq >= fromSeq);
  return readEvents(eventsFile(id), fromSeq);
}

/** The folded state of a run — the same reducer the browser uses. */
export async function getRunState(id: string): Promise<RunState | null> {
  if (!isValidRunId(id)) return null;
  const events = await getEvents(id);
  if (events.length === 0) return null;
  return events.reduce(reduceRun, emptyRunState());
}

export async function getRunInput(id: string): Promise<RunInput | null> {
  const run = store.runs.get(id);
  if (run) return run.input;
  try {
    return JSON.parse(await readFile(runPath(id, "input.json"), "utf8")) as RunInput;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The run index
// ---------------------------------------------------------------------------

const STALE_AFTER_MS = 5 * 60_000;

export async function listRuns(): Promise<RunIndexEntry[]> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const rows = JSON.parse(raw) as RunIndexEntry[];
    return rows
      .map(reconcile)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch {
    return [];
  }
}

/**
 * A row saying "running" that nothing in this process is driving was interrupted —
 * the server was restarted, or it crashed. Nothing will ever finish it, so report it
 * as failed rather than leaving a run spinning in the list forever. The grace period
 * keeps a run started by another instance (a second dev server on the same data
 * directory) from being mislabelled while it is genuinely still going.
 */
function reconcile(row: RunIndexEntry): RunIndexEntry {
  if (row.status !== "running" || store.runs.has(row.id)) return row;
  const age = Date.now() - Date.parse(row.startedAt);
  return Number.isFinite(age) && age > STALE_AFTER_MS
    ? { ...row, status: "failed" }
    : row;
}

/** Serialised: two runs finishing at once must not clobber each other's row. */
let indexQueue: Promise<void> = Promise.resolve();

function upsertIndex(entry: RunIndexEntry): Promise<void> {
  indexQueue = indexQueue
    .catch(() => {})
    .then(async () => {
      const rows = await listRuns();
      const next = [entry, ...rows.filter((r) => r.id !== entry.id)];
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(INDEX_FILE, JSON.stringify(next, null, 2), "utf8");
    });
  return indexQueue;
}
