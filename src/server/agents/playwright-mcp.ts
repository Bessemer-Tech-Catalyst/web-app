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
 * The session does not survive the server: each agent gets its own process, so Recon's
 * login reaches the Planner as `results/state.json` (written by the seed spec) rather
 * than as live browser state. That is the more durable arrangement anyway — a resumed
 * run picks up the file, where it could never have picked up a dead process.
 */

import { MCPServerStdio } from "@openai/agents";
import { runPath } from "../paths";
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
 * Spawns the MCP server for a run. Not connected — the caller owns the lifecycle so a
 * `finally` can always close it; an orphaned Chromium outlives the run otherwise.
 */
export function createPlaywrightServer(
  runId: string,
  input: RunInput,
  agent: "recon" | "planner",
  /** Path to the watch overlay, when this is a headed run someone is watching. */
  overlayPath?: string,
): MCPServerStdio {
  const headed = !input.options.headless;
  const options: ConstructorParameters<typeof MCPServerStdio>[0] = {
    name: `playwright-${agent}`,
    command: "npx",
    args: [
      "--no-install",
      "@playwright/mcp@0.0.80",
      ...(input.options.headless ? ["--headless"] : []),
      // A headed run is being watched by a person, so it is tuned for a person: a
      // window sized to be legible over a shoulder, a longer settle so each action is
      // separable rather than a blur, and the cursor overlay that makes Playwright's
      // synthetic clicks visible at all.
      ...(headed
        ? [
            // Small enough to sit beside the Odyssey UI on one screen — the point of a
            // headed run is watching the agent and the Decision Log together, not
            // filling the display with the app under test.
            "--viewport-size",
            "900x620",
            // A person needs longer than a machine to see what happened. This pauses
            // after each action so clicks and navigations are separable rather than a
            // blur; it costs wall-clock time and buys the whole demo.
            "--timeout-settle",
            "1200",
            ...(overlayPath ? ["--init-script", overlayPath] : []),
          ]
        : []),
      // Keep the profile in memory so runs cannot contaminate each other, and so a
      // run's cookies are not left on disk after it finishes.
      "--isolated",
      "--block-service-workers",
      // Traces, screenshots and videos land in the run workspace like every other
      // artifact, so the report can cite them by workspace-relative path.
      "--output-dir",
      runPath(runId, "results"),
      // The MCP server's own filesystem access is confined to the run workspace.
      "--caps",
      "vision",
    ],
    cwd: runPath(runId),
    // Deliberately not inheriting process.env: the model provider key has no business
    // inside the browser process, and neither does anything else in the app's env.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    cacheToolsList: true,
    toolFilter: {
      allowedToolNames: agent === "recon" ? RECON_TOOLS : PLANNER_TOOLS,
    },
    clientSessionTimeoutSeconds: 120,
  };
  return new MCPServerStdio(options);
}

/** Runs `body` with a connected server and always closes it, even on abort. */
export async function withPlaywright<T>(
  runId: string,
  input: RunInput,
  agent: "recon" | "planner",
  body: (server: MCPServerStdio) => Promise<T>,
): Promise<T> {
  // Written into the run workspace rather than shipped as a file on disk, so it cannot
  // go missing from a production build and so the run is self-describing afterwards.
  let overlayPath: string | undefined;
  if (!input.options.headless) {
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
