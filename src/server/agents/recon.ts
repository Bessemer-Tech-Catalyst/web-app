/**
 * Recon — the agent that makes a bare URL enough.
 *
 * §4: "Recon is our own addition and it matters: it's what makes the whole thing work
 * from a bare URL with no seed test." It logs in if credentials are given, crawls
 * breadth-first to a depth cap, compacts each page to an interactive-element digest —
 * never raw HTML, which is the Hercules lesson and also 40× the tokens — and leaves the
 * browser session authenticated for the Planner that follows it.
 *
 * What it does *not* do is judge. It reports what exists; whether the plan covers it is
 * the Critic's call and whether that is good enough is the orchestrator's.
 */

import { writeArtifact } from "../workspace";
import { STATE_FILE, captureStorageState, carriesSession, describeStorageState } from "./storage-state";
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { reconSchema, toEvidence } from "./schemas";
import { siteBriefing } from "./site-policy";
import { crawlBriefing } from "./route-scope";
import type { AgentContext, ReconResult } from "../orchestrator/agents";

const BASE_INSTRUCTIONS = `You are Recon, the first agent in an autonomous end-to-end test pipeline.

Your job is to map an unfamiliar web application so a Planner can write a test plan
against it, and to leave the browser in whatever session state the Planner will need.

Method:
1. Navigate to the target URL and take an accessibility snapshot. Work from the
   snapshot, never from raw HTML — the snapshot is the interactive-element digest and
   it is what keeps this affordable.
   Client-rendered applications return an empty snapshot until they hydrate, and an
   empty snapshot is not an empty page. Whenever a snapshot comes back with no
   interactive elements, wait a few seconds and take it again before concluding
   anything about that route. Do the same after every navigation and after any action
   that changes the view.
2. If credentials were supplied, sign in and prove it: take a snapshot afterwards and
   confirm a signed-in affordance is present (an account menu, a sign-out control, a
   greeting). Do not report authenticated:true on the strength of a form submission
   that you did not verify.
3. Crawl from the landing page outward, best-first rather than blindly breadth-first:
   at each step go to the most informative unvisited surface, not the next link in
   document order. The crawl budget below is not advice — navigations outside the
   target's domain and navigations past the surface budget are refused by the harness
   before the browser sees them, and the refusal tells you what is left. Plan around it
   rather than discovering it.
4. Do not perform destructive actions. Do not place orders, delete records, change
   settings or send messages. You are mapping, not exercising.

Report:
- routes: every distinct path you actually reached, as paths, not full URLs.
- authenticated: whether a signed-in session is live at the end of your crawl.
- archetype: what kind of application this is, in a few words.
- evidence: the observations a Critic could later score a test plan against. This is
  the most valuable thing you produce, so be concrete and quantitative where you can.
  Prioritise surfaces that are reachable but easy to overlook — password reset, empty
  states, permission-gated pages, destructive controls, error paths. Each is one
  evidence item with kind "heuristic" unless a more specific kind genuinely fits.`;

/**
 * The prompt, with everything the preflight learned appended.
 *
 * Kept as a function rather than a constant because the second half is different for
 * every target: how far to crawl, which hosts are in scope, what stands in front of the
 * content, and what kind of application this appears to be. With no preflight it returns
 * exactly the constant it always was.
 */
function instructions(ctx: AgentContext): string {
  if (!ctx.target) return BASE_INSTRUCTIONS;
  return [
    BASE_INSTRUCTIONS,
    "",
    crawlBriefing(
      ctx.target.crawl,
      {
        origin: ctx.target.profile.origin,
        registrableDomain: ctx.target.profile.registrableDomain,
        robotsDisallow: ctx.target.profile.robotsDisallow,
      },
      ctx.target.profile.sameOriginPaths,
    ),
    "",
    siteBriefing(ctx.target.profile, ctx.target.policy, "recon"),
  ].join("\n");
}

/**
 * The turn ceiling, derived from the crawl budget rather than pinned at a magic number.
 *
 * A surface costs a navigate, a snapshot, and — on a client-rendered application —
 * usually a settle and a second snapshot: call it three to four turns each. A ceiling
 * that does not move with the budget is the quiet failure this used to have, where a
 * crawl allowed twenty surfaces was cut off by a sixty-turn limit at around fifteen and
 * reported a short route list rather than an error.
 */
function turnsFor(ctx: AgentContext): number {
  const surfaces = ctx.target?.crawl.maxSurfaces ?? 20;
  const perSurface = ctx.target?.profile.rendering === "client" ? 4 : 3;
  return Math.max(60, Math.min(200, surfaces * perSurface + 15));
}

export async function recon(ctx: AgentContext): Promise<ReconResult> {
  const tier = models.recon;

  const out = await withPlaywright(
    ctx.runId,
    ctx.input,
    "recon",
    async (server) => {
    const result = await runStructured(ctx, {
      as: "recon",
      name: "Recon",
      tier,
      instructions: instructions(ctx),
      input: buildInput(ctx),
      outputType: reconSchema,
      mcpServers: [server],
      maxTurns: turnsFor(ctx),
      // The crawl is the longest-running stage and the one most exposed to a slow
      // target, so it gets the most room before the wall clock takes the stage back.
      deadlineMs: 15 * 60_000,
    });

    // The session hand-off, taken here because *this* is the browser that performed the
    // login and it is still open. Every later agent is seeded from the file this writes.
    // Leaving it to the shared on-disk profile was a race with Chrome's lazy cookie
    // flush: `run_0c3d41d1` had Recon report an authenticated crawl of four routes and
    // the Generator, two stages later, quarantine every scenario for being signed out.
    const state = await captureStorageState(ctx.runId, ctx.input.url, server);
    if (state && carriesSession(state)) {
      ctx.tool("recon", "browser_storage_state", describeStorageState(state));
    } else {
      ctx.tool(
        "recon",
        "browser_storage_state",
        state
          ? `Captured nothing at ${ctx.input.url}: 0 cookies and 0 localStorage entries. ` +
              (ctx.input.credentials
                ? "Credentials were supplied, so the agents after this one will browse signed out."
                : "No credentials were supplied, so this is expected.")
          : `Could not read ${STATE_FILE}; the agents after this one fall back to the shared profile.`,
        // Only a failure when there was a session to lose.
        !ctx.input.credentials,
      );
    }
    return result;
    },
    ctx.target,
    (attempt, delayMs, error) =>
      ctx.tool(
        "recon",
        "browser_connect",
        `The browser did not start on attempt ${attempt} — retrying in ${Math.round(delayMs / 1000)}s`,
        false,
        String(error),
      ),
  );

  const result: ReconResult = {
    routes: dedupe(out.routes),
    authenticated: out.authenticated,
    evidence: [
      { kind: "heuristic", summary: `Detected app archetype: ${out.archetype}` },
      ...toEvidence(out.evidence),
    ],
  };

  await writeArtifact(ctx.runId, "recon.json", JSON.stringify(result, null, 2));
  ctx.artifact(
    "plan",
    "recon.json",
    `Recon map — ${result.routes.length} routes, ${result.evidence.length} observations`,
  );

  // Recon does not write a seed spec. It used to, and the spec it wrote was a lie: it
  // navigated to "/" and saved storage state without ever logging in, and nothing
  // executed it. What replaced it is the capture above: a `storageState` file dumped out
  // of the browser that actually logged in, which is what both the later agents and
  // `playwright test` need, and which needs no extra execution step at all.

  return result;
}

/**
 * The prompt's variable half. Credentials are passed here because the browser needs
 * them to log in — the workspace never sees them (see `scaffoldWorkspace`) and the
 * event log redacts them (see `runStructured`).
 */
function buildInput(ctx: AgentContext): string {
  const { url, intent, prd, credentials } = ctx.input;
  const lines = [`Target: ${url}`];
  if (intent) lines.push(`Stated intent: ${intent}`);
  if (prd) lines.push(`A PRD is attached to this run (${prd.filename}); bias the crawl toward the surfaces it describes.`);
  lines.push(
    credentials
      ? `Credentials are available. Sign in as "${credentials.username}" with the password "${credentials.password}" and crawl as that user.`
      : "No credentials were supplied. Crawl as an anonymous visitor and note which surfaces appear to require a session.",
  );
  return lines.join("\n");
}

function dedupe(routes: string[]): string[] {
  return [...new Set(routes.map((r) => r.trim()).filter(Boolean))];
}
