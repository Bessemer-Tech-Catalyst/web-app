/**
 * PRD-to-test-plan gap analysis — the brief's first Bonus item.
 *
 *   "after generation, compare the test plan against stated product requirements and
 *    surface what is not covered"
 *
 * The obvious build is one model call: here is a PRD, here is a plan, return a matrix.
 * It renders beautifully and it is wrong in two ways that a rendered matrix hides
 * completely, so both are checked mechanically afterwards in `prd-gate.ts`:
 *
 *   1. **A cited scenario that does not exist.** A model that cannot find a scenario for
 *      a requirement will sometimes name one anyway. That is not a weak tick, it is a
 *      false one, and it lands on the requirement most likely to be uncovered.
 *
 *   2. **A plan mistaken for evidence.** This is the one worth the slide. A requirement
 *      mapped to a scenario the Generator *quarantined* has no test behind it at all. The
 *      naive matrix ticks it, and the team reads "your PRD is covered" about a flow
 *      nothing ever loaded. Coverage here is resolved through what the run actually did,
 *      into four states rather than a boolean, and the middle two are the interesting
 *      ones:
 *
 *        proven        a test covering it ran and passed
 *        exercised     a test covering it ran and is red — evidence, and it is bad news
 *        planned-only  the plan covers it; no test that ran reached it
 *        uncovered     nothing in the plan addresses it
 *
 * The model is also required to return a verbatim `quote` per requirement. That is the
 * cheapest possible defence against a confident extraction of requirements the document
 * does not contain: a reader can check any row against the PRD in seconds.
 *
 * No browser and no tools. The inputs are two documents, and a stage that can browse
 * would produce a different matrix depending on how long it browsed.
 */

import { writeArtifact } from "../workspace";
import { runStructured } from "./harness";
import { models } from "./models";
import { gateTrace, untracedScenarios } from "./prd-gate";
import { prdSchema } from "./schemas";
import type { AgentContext } from "../orchestrator/agents";
import type { PrdRequirement, Scenario, TestResult } from "@/lib/types";

/**
 * How much of the PRD reaches the model.
 *
 * The Planner already reads the first 20k; this stage reads more because it is doing
 * extraction rather than inspiration, and a requirement in the back half of a document
 * that never reaches the matrix is exactly the gap this feature exists to surface.
 */
const PRD_LIMIT = 60_000;

const INSTRUCTIONS = `You are the PRD Traceability stage in an autonomous end-to-end test pipeline.

You are given a product requirements document and the test plan an agent wrote for the
same application. You produce the matrix that says which stated requirements have a test
behind them and which do not.

Extract requirements, not prose. A requirement is a statement about what the product must
do that could be true or false of a running application — "users can sign in with email
and password", "declined payments must preserve the cart". Headings, background,
rationale, timelines, team names and non-functional aspirations are not requirements.
Prefer the document's own identifiers (REQ-4, §2.1, US-12) when it has them; number them
R1, R2, … when it does not.

For every requirement, set "quote" to text copied VERBATIM from the document — the
sentence or clause the requirement comes from, not your paraphrase of it. A reader checks
your extraction against the document with that string, so it has to appear in it.

Map each requirement to the scenario ids that would prove it. Use only ids from the plan
you were given. If nothing in the plan covers a requirement, return an empty list — that
is the single most valuable row in this matrix and inventing an id to fill it destroys
the only thing it was for. A scenario may cover several requirements and a requirement
may need several scenarios.

Judge coverage by what the scenario actually does, not by shared vocabulary. A scenario
that signs in successfully does not cover a requirement about rejecting invalid
credentials, however many words they have in common.

You are mapping the PLAN. Do not consider whether the tests passed — that is resolved
after you, from the run's own results, and a requirement whose scenario never ran will be
reported as having no evidence regardless of what you say here.`;

export async function tracePrd(
  ctx: AgentContext,
  req: { scenarios: Scenario[]; results: TestResult[] },
): Promise<PrdRequirement[] | undefined> {
  const prd = ctx.input.prd;
  if (!prd) return undefined;

  ctx.tool(
    "orchestrator",
    "Read",
    `${prd.filename} — ${prd.text.length.toLocaleString()} chars, tracing requirements to ${req.scenarios.length} scenarios`,
  );

  if (ctx.overBudget()) {
    ctx.tool(
      "orchestrator",
      "prd_trace",
      "Budget spent before the PRD trace could run. No matrix is published — an absent matrix is honest, a guessed one is not.",
      false,
    );
    return undefined;
  }

  const out = await runStructured(ctx, {
    as: "orchestrator",
    name: "PRD Traceability",
    tier: models.prd,
    instructions: INSTRUCTIONS,
    input: buildInput(prd, req.scenarios),
    outputType: prdSchema,
    maxTurns: 4,
  });

  const { requirements, invented } = gateTrace(out.requirements, req.scenarios, req.results);

  // The gate's findings are reported, never swallowed. An extraction that invented three
  // references is telling you how much to trust the other forty.
  if (invented.length) {
    ctx.tool(
      "orchestrator",
      "verify_scenario_references",
      `Struck out ${invented.length} citation(s) naming scenarios the plan does not contain: ${invented.join(", ")}.`,
      false,
    );
  }

  const untraced = untracedScenarios(requirements, req.scenarios);
  const counts = tally(requirements);
  ctx.tool(
    "orchestrator",
    "prd_trace",
    `${requirements.length} requirements — ${counts.proven} proven, ${counts.exercised} exercised, ` +
      `${counts["planned-only"]} planned but never run, ${counts.uncovered} with nothing in the plan. ` +
      `${untraced.length} scenario(s) trace to no requirement.`,
    counts.uncovered === 0 && counts["planned-only"] === 0,
  );

  await writeArtifact(
    ctx.runId,
    "prd-trace.json",
    JSON.stringify({ source: prd.filename, requirements, invented, untraced }, null, 2),
  );
  ctx.artifact(
    "plan",
    "prd-trace.json",
    `PRD traceability — ${counts.uncovered + counts["planned-only"]} of ${requirements.length} requirements without evidence`,
  );

  return requirements;
}

/** Scenario ids no requirement claims — cached for the report, computed here once. */
export function untracedFor(
  requirements: PrdRequirement[],
  scenarios: Scenario[],
): string[] {
  return untracedScenarios(requirements, scenarios);
}

function buildInput(
  prd: { filename: string; text: string },
  scenarios: Scenario[],
): string {
  const truncated = prd.text.length > PRD_LIMIT;
  return [
    `Product requirements document: ${prd.filename}`,
    "---",
    prd.text.slice(0, PRD_LIMIT),
    "---",
    truncated
      ? `(The document was truncated at ${PRD_LIMIT.toLocaleString()} characters. Extract from what you were given and do not guess at the remainder.)`
      : "",
    "",
    `The test plan — ${scenarios.length} scenarios. Map to these ids and no others:`,
    "---",
    JSON.stringify(
      scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        flow: s.flow,
        kind: s.kind,
        steps: s.steps,
        expected: s.expected,
      })),
      null,
      2,
    ),
    "---",
  ]
    .filter(Boolean)
    .join("\n");
}

function tally(requirements: PrdRequirement[]) {
  const counts = { proven: 0, exercised: 0, "planned-only": 0, uncovered: 0 };
  for (const r of requirements) {
    const key = r.status ?? (r.covered ? "proven" : "uncovered");
    counts[key] += 1;
  }
  return counts;
}
