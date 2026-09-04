/**
 * Where a run's workspace lives on disk.
 *
 * Everything a run produces — the plan, the tests, the traces, the event log — is a
 * file under one directory. That is the whole persistence story (see
 * docs/IMPLEMENTATION_PLAN.md §2.1): no Postgres, no Redis, nothing to fail on stage.
 */

import path from "node:path";

/** Overridable so tests and the replay harness can point at a scratch directory. */
export const DATA_DIR =
  process.env.ODYSSEY_DATA_DIR ?? path.join(process.cwd(), ".odyssey");

export const RUNS_DIR = path.join(DATA_DIR, "runs");

/** The index of every run we have ever started. Rebuildable from the run dirs. */
export const INDEX_FILE = path.join(DATA_DIR, "runs.json");

export const runDir = (runId: string) => path.join(RUNS_DIR, runId);

export const runPath = (runId: string, ...rest: string[]) =>
  path.join(runDir(runId), ...rest);

export const eventsFile = (runId: string) => runPath(runId, "events.ndjson");

/** Rejects anything that could escape RUNS_DIR — run ids arrive from the URL. */
export function isValidRunId(id: string): boolean {
  return /^run_[a-z0-9]{6,32}$/.test(id);
}
