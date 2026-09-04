/**
 * Every run drives a visible browser. This is a product invariant, not a preference.
 *
 * The Decision Log explains what the orchestrator chose; the window explains what it
 * actually did. Watching a real browser log in, hunt for a locator and fail is most of
 * what makes this legible to someone who has not read the event log — so it is not an
 * option on `RunInput`, and no API caller can turn it off. A guarantee that a request
 * body can flip is not a guarantee.
 *
 * The single escape hatch is server-side and exists because a headed browser needs a
 * display: on a machine with no X server or no desktop session, Chromium does not start
 * at all and the run fails before recon. `ODYSSEY_HEADLESS=1` is for CI and for a
 * container, and it is deliberately awkward to reach — it cannot be set per run, only
 * for the whole server process.
 */

/** True only when the operator has declared this process has no display. */
export function headless(): boolean {
  const v = process.env.ODYSSEY_HEADLESS?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Headed unless the process has been told it has no display. The normal case. */
export const headed = () => !headless();

/**
 * Window geometry for a watched run. Small enough to sit beside the Odyssey UI on one
 * screen — the point of a headed run is watching the browser and the Decision Log
 * together, not filling the display with the app under test.
 */
export const WATCH_VIEWPORT = { width: 900, height: 620 };

/**
 * How long the browser pauses after each action so a person can separate one step from
 * the next. A machine does not need this; it is bought entirely for the watcher, and it
 * is why a headed run takes longer than a headless one.
 */
export const WATCH_SETTLE_MS = 1200;
