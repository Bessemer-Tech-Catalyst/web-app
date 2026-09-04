/**
 * The auth hand-off to `playwright test`.
 *
 * Every MCP agent shares one on-disk Chrome profile (see `profileDir`), which is how
 * Recon's login survives into the Planner and the Generator. The generated suite cannot
 * use that: `playwright test` has no `--user-data-dir`, it takes a `storageState` file.
 * So before the Generator writes a line, the orchestrator dumps the live session out of
 * the browser it already has open, and the suite is pointed at the dump.
 *
 * Two details this exists to get right, both of which silently produce a logged-out
 * suite when missed:
 *
 *   1. **Navigate first.** `storageState()` reads localStorage only for origins the
 *      browser context has actually visited in this session — it walks the open pages.
 *      A context that has just opened a profile has visited nothing, so it returns
 *      cookies and an empty `origins`, which looks like a successful dump and is not.
 *   2. **localStorage is the point.** The Phase 3 target authenticates with a bearer
 *      token in localStorage and no session cookie at all. A capture judged on its
 *      cookie count would have been called a success while carrying nothing.
 *
 * Hence `describeStorageState`, which reports what was actually captured, per origin,
 * and lets the Generator say so out loud rather than assume.
 *
 *   3. **A capture is written to a scratch file and only promoted if it carries a
 *      session.** An empty dump used to overwrite a good one, which turns "this agent's
 *      browser happened to be signed out" into "the whole run has no session" — and the
 *      symptom of that appears three stages later as every scenario quarantined for
 *      being unable to sign in.
 */

import { copyFile, readFile } from "node:fs/promises";
import { runPath } from "../paths";
import type { MCPServerStdio } from "@openai/agents";

/** Where the dump lands, relative to the run workspace. Referenced by the config too. */
export const STATE_FILE = "results/state.json";

/** Where a capture lands before it has earned the right to replace `STATE_FILE`. */
const SCRATCH_FILE = "results/state.capture.json";

export interface StorageStateSummary {
  cookies: number;
  origins: { origin: string; keys: number }[];
  /** localStorage entries across every origin — the number that actually matters here. */
  localStorageKeys: number;
}

interface RawState {
  cookies?: unknown[];
  origins?: { origin?: string; localStorage?: unknown[] }[];
}

/**
 * Dumps the shared profile's live session to `results/state.json` and reports what was
 * in it. Returns null when the dump did not happen or produced nothing readable — the
 * caller decides what that means, which for a credentialed run is a problem worth saying
 * out loud and for an anonymous one is simply the truth.
 *
 * `browser_storage_state` is called directly rather than offered to the model: reading a
 * run's session out is the orchestrator's business, and the tool is deliberately absent
 * from `GENERATOR_TOOLS`.
 */
export async function captureStorageState(
  runId: string,
  url: string,
  server: MCPServerStdio,
): Promise<StorageStateSummary | null> {
  // See (1) above: this navigation is what makes the origin's localStorage visible.
  await server.callTool("browser_navigate", { url });
  await server.callTool("browser_storage_state", { filename: SCRATCH_FILE });

  let raw: RawState;
  try {
    raw = JSON.parse(await readFile(runPath(runId, SCRATCH_FILE), "utf8")) as RawState;
  } catch {
    return null;
  }

  const origins = (raw.origins ?? []).map((o) => ({
    origin: String(o.origin ?? "?"),
    keys: Array.isArray(o.localStorage) ? o.localStorage.length : 0,
  }));

  const summary: StorageStateSummary = {
    cookies: Array.isArray(raw.cookies) ? raw.cookies.length : 0,
    origins,
    localStorageKeys: origins.reduce((n, o) => n + o.keys, 0),
  };

  // See (3): promote only a capture that carries something. A later agent whose browser
  // came up signed out must not be able to erase the session an earlier one proved.
  if (carriesSession(summary)) {
    await copyFile(runPath(runId, SCRATCH_FILE), runPath(runId, STATE_FILE));
  }
  return summary;
}

/** Whether a capture holds anything that could authenticate the suite. */
export const carriesSession = (s: StorageStateSummary) => s.cookies > 0 || s.localStorageKeys > 0;

/**
 * Whether this run already has a session on file, and what is in it.
 *
 * This is what makes the hand-off deterministic. It used to rest entirely on the shared
 * Chrome profile: Recon signed in, and the Planner and Generator opened the same
 * `--user-data-dir` and were expected to find the cookie there. **Chrome flushes its
 * cookie store to disk lazily**, so whether a session survived from one agent's browser
 * to the next was a race with a background timer — which is exactly as reliable as it
 * sounds. It won on `run_1ad8602e` and lost on `run_0c3d41d1`, where Recon reported an
 * authenticated crawl of four routes and the Generator, twelve minutes later, quarantined
 * all three scenarios because it could not sign in.
 *
 * A file we wrote, at a moment we chose, while the browser that had the session was still
 * open, has no such timer in it.
 */
export async function readStorageState(runId: string): Promise<StorageStateSummary | null> {
  try {
    const raw = JSON.parse(await readFile(runPath(runId, STATE_FILE), "utf8")) as RawState;
    const origins = (raw.origins ?? []).map((o) => ({
      origin: String(o.origin ?? "?"),
      keys: Array.isArray(o.localStorage) ? o.localStorage.length : 0,
    }));
    return {
      cookies: Array.isArray(raw.cookies) ? raw.cookies.length : 0,
      origins,
      localStorageKeys: origins.reduce((n, o) => n + o.keys, 0),
    };
  } catch {
    return null;
  }
}

/** One line for the activity feed, made of nothing but what was measured. */
export function describeStorageState(s: StorageStateSummary): string {
  const where = s.origins.length
    ? s.origins.map((o) => `${o.origin} (${o.keys})`).join(", ")
    : "no origins";
  return `${STATE_FILE} — ${s.cookies} cookie(s), ${s.localStorageKeys} localStorage entr(ies) across ${where}`;
}
