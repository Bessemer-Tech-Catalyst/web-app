/**
 * The Planner — open-ended exploration, written as human-readable scenarios.
 *
 * It gets read-only browsing (see `PLANNER_TOOLS`): it may look at a page to ground a
 * step, but it never mutates the app it is planning against. Its output is a spec file
 * a person could read and disagree with, not code — turning a scenario into a test with
 * proven locators is the Generator's job in Phase 4.
 *
 * From attempt 2 onward the Critic's gaps arrive as directives. The Planner's contract
 * there is narrow and worth stating: keep what already works, close the named gaps, and
 * mark exactly the scenarios that exist because of a directive. The orchestrator reports
 * "N added by critique" from that flag, so a Planner that quietly rewrites the whole
 * plan makes the Decision Log lie.
 */

import { readFile } from "node:fs/promises";
import { runPath } from "../paths";
import { writeArtifact } from "../workspace";
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { planSchema, toScenarios } from "./schemas";
import { renderSpec } from "./spec-format";
import type { AgentContext, PlanRequest, ReconResult } from "../orchestrator/agents";
import type { Scenario } from "@/lib/types";

const INSTRUCTIONS = `You are the Planner in an autonomous end-to-end test pipeline.

You write a test plan for a web application: numbered, human-readable scenarios with
user-visible steps and an observable expected result. You do not write code and you do
not write selectors — a later agent proves every locator against the live page, and a
step that names a CSS selector makes its job harder, not easier.

You may browse the application read-only to ground a step in what is actually there.
Prefer one snapshot of a page you are unsure about over three guesses about it. Never
attempt to change application state: no form submissions, no purchases, no deletions.
An empty snapshot means the page has not hydrated yet, not that the page is empty —
wait and snapshot again before you draw a conclusion from it.

What a good plan looks like:
- Every scenario is independently runnable and bootstraps its own session.
- Steps are what a user does, in order, in plain language.
- "expected" is a single observable outcome, specific enough to fail on.
- Coverage spans kinds, not just happy paths. Negative input, permission boundaries,
  error states, edge cases and destructive actions are where real defects live, and a
  plan made only of happy paths will be sent back to you by the Coverage Critic.
- Priority reflects user and business impact, not how easy the test is to write.

Scenario ids are stable slugs, lowercase and hyphenated, derived from the flow and the
case — "checkout-expired-card", not "scenario-7". If you are revising a plan, a
scenario that survives keeps the id it had.

When revising against critic directives the scenario budget is binding, and it will
usually already be full. Dropping a scenario to make room for a directive is a
regression, not a trade: the critic scores the plan you hand back, sees the coverage you
removed, and raises it as a fresh gap — so a revision that swaps five scenarios for five
others scores the same twice and burns a re-plan cycle for nothing. Therefore:

- Remove a scenario only when it is genuinely redundant with another in your revision,
  never merely to free a slot.
- Prefer widening an existing scenario over adding a new one. A scenario that already
  visits a page can assert one more thing about it, and that costs no budget.
- If the directives still do not fit, close them in severity order and leave the rest
  open. Unclosed gaps are carried into a risk ledger and reported honestly; deleted
  coverage is not, and is strictly worse.`;

export async function plan(ctx: AgentContext, req: PlanRequest): Promise<Scenario[]> {
  const tier = models.planner;

  const input = await buildInput(ctx, req);

  const out = await withPlaywright(ctx.runId, ctx.input, "planner", (server) =>
    runStructured(ctx, {
      as: "planner",
      name: "Planner",
      tier,
      instructions: INSTRUCTIONS,
      input,
      outputType: planSchema,
      mcpServers: [server],
      maxTurns: 50,
    }),
  );

  const scenarios = capped(ctx, toScenarios(out), scenarioBudget(ctx, req.attempt));

  const path = await writeArtifact(
    ctx.runId,
    "specs/core.md",
    renderSpec(ctx.input.url, scenarios),
  );
  ctx.tool("planner", "Write", `${path} — ${scenarios.length} scenarios`);
  ctx.artifact(
    "plan",
    path,
    `Test plan v${req.attempt} — ${scenarios.length} scenarios` +
      (req.attempt > 1
        ? ` (${scenarios.filter((s) => s.addedByCritique).length} added by critique)`
        : ""),
  );

  return scenarios;
}

/**
 * How many scenarios this attempt may produce.
 *
 * The first pass deliberately gets less than the run's cap. It used to get all of it,
 * and the Planner did what it was told: it filled the budget, the Critic then named the
 * gaps, and the revision arrived with zero free slots and no way to close a gap except by
 * deleting coverage — which the Critic scores as a fresh gap. The loop could not converge.
 *
 * Observed directly: the same target capped at 8 stalled at 62 → 70 across a re-plan,
 * while capped at 10 it reached 82 and passed. The difference was headroom, not the model.
 *
 * So the cap the user set stays absolute, and the room to close gaps is carved out of the
 * first pass instead of added to the last one.
 */
function scenarioBudget(ctx: AgentContext, attempt: number): number {
  const max = ctx.input.options.maxScenarios;
  return attempt === 1 ? Math.max(1, Math.ceil(max * 0.75)) : max;
}

async function buildInput(ctx: AgentContext, req: PlanRequest): Promise<string> {
  const { url, intent, prd } = ctx.input;
  const budget = scenarioBudget(ctx, req.attempt);
  const lines = [
    `Target: ${url}`,
    `Budget: at most ${budget} scenarios. Spend them on impact, not breadth for its own sake.`,
  ];

  if (intent) {
    lines.push(
      `Stated intent: ${intent}`,
      "Scope the plan around that intent. Surfaces outside it are still worth one scenario each if they carry real risk, but they are not the point of this run.",
    );
  } else {
    lines.push("No intent was stated. Plan broadly across every surface Recon discovered.");
  }

  if (prd) {
    lines.push(
      `Product requirements (${prd.filename}) — every requirement below should be traceable to at least one scenario:`,
      "---",
      prd.text.slice(0, 20_000),
      "---",
    );
  }

  lines.push("", "Recon findings for this application:", await reconDigest(ctx));

  if (req.attempt > 1 && req.previous) {
    lines.push(
      "",
      `This is revision ${req.attempt}. Your previous plan is below. Keep the scenarios that stand, keep their ids, and close the directives that follow.`,
      budget - req.previous.length > 0
        ? `You have ${budget - req.previous.length} unused scenario slot(s). Beyond that, close directives by widening an existing scenario.`
        : `The budget is already full at ${req.previous.length} of ${budget} scenarios. There are no free slots, so directives must be closed by widening existing scenarios — not by deleting coverage to make room. Re-read the rule about this in your instructions before revising.`,
      "---",
      JSON.stringify(req.previous, null, 2),
      "---",
      "",
      `The Coverage Critic rejected that plan with ${req.directives.length} directive(s). Each one must be closed by at least one scenario, and every scenario you add for a directive must set addedByCritique to true:`,
      ...req.directives.map(
        (g, i) => `${i + 1}. [${g.dimension}, ${g.severity}] ${g.title} — ${g.rationale}`,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Recon's map, rendered into the prompt.
 *
 * Read back off `recon.json` rather than threaded through the `plan()` signature. That
 * keeps the seam in `orchestrator/agents.ts` unchanged — the orchestrator has no reason
 * to know that the Planner wants Recon's output — and it means a resumed or replayed
 * run plans from exactly the ground truth the original run did.
 */
async function reconDigest(ctx: AgentContext): Promise<string> {
  let recon: ReconResult;
  try {
    recon = JSON.parse(await readFile(runPath(ctx.runId, "recon.json"), "utf8")) as ReconResult;
  } catch {
    return "(recon.json is unavailable — plan from the target URL alone)";
  }
  return [
    `Routes (${recon.routes.length}): ${recon.routes.join(", ")}`,
    `Authenticated session: ${recon.authenticated ? "yes" : "no"}`,
    "Observations:",
    ...recon.evidence.map((e) => `- ${e.summary}${e.detail ? ` (${e.detail})` : ""}`),
  ].join("\n");
}

/**
 * Trims to the run's ceiling, keeping the highest-priority scenarios.
 *
 * A backstop, not the mechanism — the budget is stated in the prompt, and a Planner
 * that respects it never reaches here. When it does fire it silently deletes real
 * coverage, so it reports itself as a failed tool call rather than trimming quietly. A
 * plan that is one scenario shorter than the model wrote is otherwise never noticed.
 */
function capped(ctx: AgentContext, scenarios: Scenario[], max: number): Scenario[] {
  if (scenarios.length <= max) return scenarios;
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const kept = [...scenarios].sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, max);
  const dropped = scenarios.filter((s) => !kept.includes(s));
  ctx.tool(
    "planner",
    "cap_scenarios",
    `Plan exceeded the ${max}-scenario budget; dropped ${dropped.length} lowest-priority: ` +
      dropped.map((s) => s.id).join(", "),
    false,
  );
  return kept;
}
