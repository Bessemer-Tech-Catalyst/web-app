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
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { reconSchema, toEvidence } from "./schemas";
import type { AgentContext, ReconResult } from "../orchestrator/agents";

const INSTRUCTIONS = `You are Recon, the first agent in an autonomous end-to-end test pipeline.

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
3. Crawl breadth-first from the landing page to a depth of 2. Prefer distinct routes
   over pagination and query-string variants of a page you have already seen. Stop at
   20 routes or when the frontier is exhausted, whichever comes first.
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

export async function recon(ctx: AgentContext): Promise<ReconResult> {
  const tier = models.recon;

  const out = await withPlaywright(ctx.runId, ctx.input, "recon", (server) =>
    runStructured(ctx, {
      as: "recon",
      name: "Recon",
      tier,
      instructions: INSTRUCTIONS,
      input: buildInput(ctx),
      outputType: reconSchema,
      mcpServers: [server],
      maxTurns: 60,
    }),
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
  // navigated to "/" and saved storage state without ever logging in, nothing executed
  // it, and the `results/state.json` the rest of the code claimed to read never existed.
  //
  // The Planner and Generator get Recon's session from the shared browser profile
  // instead (see `profileDir`), which needs no file and no extra execution step.
  //
  // A real seed spec is still owed to Phase 4: the *generated suite* runs under
  // `playwright test`, which cannot use a Chrome user-data-dir and needs a
  // `storageState` file. Writing that spec means reproducing the login as Playwright
  // code, which is the Generator's job — it is the only agent that proves locators
  // against the live page — so it belongs there, not here.

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
