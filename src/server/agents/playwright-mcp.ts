/**
 * The Playwright MCP server, one per run, with a per-agent tool allowlist.
 *
 * §4 of the plan: "a generator that can `rm -rf` is a liability". The same argument
 * applies to the browser. `browser_run_code_unsafe` and `browser_evaluate` let a model
 * execute arbitrary JavaScript in the page, and `browser_file_upload` reads the host
 * filesystem — none of the three agents in this phase have any business doing that, so
 * they are not in any allowlist. Allowlists are positive rather than a blocklist, so a
 * new tool arriving in a future @playwright/mcp release is denied by default.
 *
 * Note that the allowlist is enforced where the SDK builds an agent's tool list, not on
 * the raw MCP listing — `server.listTools()` returns everything the server exposes and
 * always will. Verify a change here against `getAllMcpTools`, not against `listTools`.
 *
 * Each agent gets its own browser process, so a session has to survive past the agent
 * that created it: Recon signs in, and the Planner and the Generator both need to be
 * that same signed-in user. They share one on-disk profile per run (`profileDir`), which
 * is what carries the cookies across. `--storage-state` cannot do this job — it only
 * *loads* state, and nothing here can write it.
 *
 * That is why `--isolated` is not used. It keeps the profile in memory, which is exactly
 * the property we cannot have: the profile dies with the process and the next agent
 * arrives logged out. Isolation *between runs* is preserved anyway, because the profile
 * lives inside the run's own workspace. The cost is that a run's cookies are now on disk
 * for the life of that workspace rather than never — acceptable, since the workspace is
 * already where the traces, screenshots and credentials-bearing artifacts live, and it
 * is gitignored.
 *
 * The profile is a lock, not just a directory: two browsers cannot hold it at once. The
 * agents run strictly in sequence and `withPlaywright` awaits `close()` before returning,
 * so that holds today — but a future stage that runs two MCP agents concurrently needs a
 * profile per agent plus an explicit state hand-off, not this.
 */

import { MCPServerStdio } from "@openai/agents";
import { WATCH_SETTLE_MS, WATCH_VIEWPORT, headed } from "../browser-mode";
import { profileDir, runPath } from "../paths";
import { writeArtifact } from "../workspace";
import { WATCH_OVERLAY } from "./watch-overlay";
import type { RunInput } from "@/lib/types";

/** Read-write browsing: enough to log in and drive a form, nothing that executes code. */
export const RECON_TOOLS = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_find",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_press_key",
  "browser_wait_for",
  "browser_tabs",
  "browser_console_messages",
  "browser_network_requests",
  "browser_take_screenshot",
];

/** Read-only browsing. The Planner looks; it never mutates the app it is planning against. */
export const PLANNER_TOOLS = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_find",
  "browser_wait_for",
  "browser_tabs",
  "browser_console_messages",
  "browser_network_requests",
];

/**
 * The Generator drives the app for real, because a locator can only be proven in the
 * state it lives in — the confirm button of a cancellation dialog does not exist until
 * something opens the dialog. So it gets Recon's interaction set plus the `testing`
 * capability's four verification tools and `browser_generate_locator`, which is the one
 * that matters: it hands back the exact Playwright expression for an element in the
 * current snapshot, so the emitted test carries a locator Playwright itself wrote rather
 * than one a model recalled.
 *
 * Still absent, for the same reason as everywhere else: `browser_evaluate` and
 * `browser_run_code_unsafe` (arbitrary JS in the page) and `browser_file_upload` (host
 * filesystem). `browser_handle_dialog` is in, because a destructive scenario has to be
 * able to dismiss the confirmation it just opened.
 */
export const GENERATOR_TOOLS = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_find",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_press_key",
  "browser_hover",
  "browser_handle_dialog",
  "browser_wait_for",
  "browser_tabs",
  "browser_console_messages",
  "browser_network_requests",
  "browser_take_screenshot",
  "browser_generate_locator",
  "browser_verify_element_visible",
  "browser_verify_text_visible",
  "browser_verify_value",
  "browser_verify_list_visible",
];

/**
 * The Classifier looks and does not touch.
 *
 * It is deciding whether the *application* is broken, so it must not be able to change
 * the application while deciding — a classifier that clicks its way into a different
 * state and then reports on that state is describing its own side effects. Console and
 * network are the two tools that matter here: an uncaught exception or a 5xx behind a
 * failing assertion is the difference between a bug worth filing and a locator worth
 * healing, and neither is visible in Playwright's error text.
 */
export const CLASSIFIER_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_find",
  "browser_wait_for",
  "browser_console_messages",
  "browser_network_requests",
  "browser_take_screenshot",
];

/**
 * The Healer gets the Generator's set, and for the same reason: it is writing locators
 * into a file that will be re-run, so it is held to the Generator's rule — every locator
 * in the patch must have been resolved on the live page in the healing session. A healer
 * allowed to guess is just a slower way of writing a red test.
 */
export const HEALER_TOOLS = GENERATOR_TOOLS;

export type McpAgent = "recon" | "planner" | "generator" | "classifier" | "healer";

const TOOLS: Record<McpAgent, string[]> = {
  recon: RECON_TOOLS,
  planner: PLANNER_TOOLS,
  generator: GENERATOR_TOOLS,
  classifier: CLASSIFIER_TOOLS,
  healer: HEALER_TOOLS,
};

/**
 * Server-side capabilities, which are a different axis from the allowlist above.
 *
 * `--caps` decides which tools the server *exposes at all*; the allowlist decides which
 * of those a given model may see. The Generator's server is started with `storage` even
 * though `browser_storage_state` is not in `GENERATOR_TOOLS`, because the orchestrator
 * calls that one itself, deterministically, to dump the signed-in session for the
 * generated suite (see `./storage-state.ts`). The model never gets offered it — which is
 * the point: reading the session out is our job, and writing one back in is nobody's.
 */
const CAPS: Record<McpAgent, string> = {
  recon: "vision",
  planner: "vision",
  generator: "testing,storage",
  classifier: "vision",
  // The Healer re-proves locators exactly as the Generator does, so it needs the same
  // `testing` verbs; it never dumps a session, so it does not get `storage`.
  healer: "testing",
};

/**
 * Spawns the MCP server for a run. Not connected — the caller owns the lifecycle so a
 * `finally` can always close it; an orphaned Chromium outlives the run otherwise.
 */
export function createPlaywrightServer(
  runId: string,
  input: RunInput,
  agent: McpAgent,
  /** Path to the watch overlay, when this is a headed run someone is watching. */
  overlayPath?: string,
): MCPServerStdio {
  const watched = headed();
  const options: ConstructorParameters<typeof MCPServerStdio>[0] = {
    name: `playwright-${agent}`,
    command: "npx",
    args: [
      "--no-install",
      "@playwright/mcp@0.0.80",
      // Headed is the normal case and the only case a person ever sees; `--headless`
      // appears only when the operator has declared the process has no display.
      ...(watched ? [] : ["--headless"]),
      // A headed run is being watched by a person, so it is tuned for a person: a
      // window sized to be legible over a shoulder, a longer settle so each action is
      // separable rather than a blur, and the cursor overlay that makes Playwright's
      // synthetic clicks visible at all.
      ...(watched
        ? [
            "--viewport-size",
            `${WATCH_VIEWPORT.width}x${WATCH_VIEWPORT.height}`,
            "--timeout-settle",
            String(WATCH_SETTLE_MS),
            ...(overlayPath ? ["--init-script", overlayPath] : []),
          ]
        : []),
      // The shared per-run profile. This is the auth hand-off: whatever session Recon
      // establishes is on disk here, so the Planner and Generator open a browser that is
      // already signed in rather than one that has to log in again — or, as before,
      // silently did not.
      "--user-data-dir",
      profileDir(runId),
      "--block-service-workers",
      // Traces, screenshots and videos land in the run workspace like every other
      // artifact, so the report can cite them by workspace-relative path.
      "--output-dir",
      runPath(runId, "results"),
      // The MCP server's own filesystem access is confined to the run workspace.
      "--caps",
      CAPS[agent],
    ],
    cwd: runPath(runId),
    // Deliberately not inheriting process.env: the model provider key has no business
    // inside the browser process, and neither does anything else in the app's env.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    cacheToolsList: true,
    toolFilter: { allowedToolNames: TOOLS[agent] },
    clientSessionTimeoutSeconds: 120,
  };
  return new MCPServerStdio(options);
}

/** Runs `body` with a connected server and always closes it, even on abort. */
export async function withPlaywright<T>(
  runId: string,
  input: RunInput,
  agent: McpAgent,
  body: (server: MCPServerStdio) => Promise<T>,
): Promise<T> {
  // Written into the run workspace rather than shipped as a file on disk, so it cannot
  // go missing from a production build and so the run is self-describing afterwards.
  let overlayPath: string | undefined;
  if (headed()) {
    await writeArtifact(runId, "watch-overlay.js", WATCH_OVERLAY);
    overlayPath = runPath(runId, "watch-overlay.js");
  }

  const server = createPlaywrightServer(runId, input, agent, overlayPath);
  await server.connect();
  try {
    return await body(server);
  } finally {
    await server.close().catch(() => {
      /* the run is already over; a failed close must not mask the real outcome */
    });
  }
}
