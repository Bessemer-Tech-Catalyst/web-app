/**
 * The Coverage Critic — the judgment the orchestrator acts on.
 *
 * This one deserves care. The Critic does not decide anything: it scores, names gaps
 * and recommends. The orchestrator decides whether to re-plan, whether the allowance is
 * spent and whether to proceed anyway (see the PLAN ⇄ CRITIQUE gate in
 * `orchestrator/run.ts`). Keeping that split is what stops the loop from becoming a
 * model arguing with itself until the budget runs out.
 *
 * Two consequences shape the implementation:
 *
 *   1. It gets no browser. Its ground truth is Recon's evidence and the plan text, and
 *      giving it tools would let it go find new surfaces mid-critique — which makes the
 *      score depend on how long it browsed rather than on the plan. A critic that is not
 *      reproducible cannot gate anything.
 *   2. Its `rationale` is shown to the user verbatim in the Decision Log, so it is
 *      prompted as prose for a human, not as a justification for a number.
 */

import { readFile } from "node:fs/promises";
import { runPath } from "../paths";
import { writeArtifact } from "../workspace";
import { runStructured } from "./harness";
import { models } from "./models";
import { critiqueSchema, toCritique } from "./schemas";
import type { AgentContext, ReconResult } from "../orchestrator/agents";
import type { Critique, Scenario } from "@/lib/types";

/**
 * The bar. Stated in the prompt rather than applied afterwards in code, because the
 * Critic has to be able to explain a `replan` verdict in the same breath as it reaches
 * one — a threshold enforced silently downstream produces a rationale that does not
 * match the verdict.
 */
const PASS_THRESHOLD = 75;

const INSTRUCTIONS = `You are the Coverage Critic in an autonomous end-to-end test pipeline.

You are given a test plan and the Recon map of the application it was written against.
You score the plan, name what it misses, and recommend whether it should be re-planned.
You do not rewrite the plan and you do not decide what happens next — an orchestrator
weighs your verdict against the run's re-plan allowance and budget. Your job is to be
right and to be legible.

Score six dimensions, each 0-100, against the Recon map as ground truth:
- flow-completeness: are the application's real user journeys covered end to end?
- negative-paths: invalid input, wrong credentials, rejected payments, validation.
- error-states: what the user sees when the system fails — 404s, timeouts, outages.
- edge-cases: boundaries, empty states, maximums, unusual but legitimate input.
- state-variants: signed out vs signed in, empty vs populated, first-run vs returning.
- destructive: deletion, cancellation, irreversible actions and their confirmations.

The overall score is your judgment of the plan as a whole, not an average — a plan that
covers every happy path and no negative path is worse than those numbers suggest.

Name a gap only where you can point at something Recon actually observed. "There is no
test for password reset, and Recon reached /forgot-password" is a gap. "There may be an
admin area" is a guess, and a guess sent back as a directive costs a re-plan cycle for
nothing. Order gaps by severity. Set verdict to "replan" when the overall score is below
${PASS_THRESHOLD} or when a critical gap is unclosed, and "pass" otherwise.

Write the rationale for the engineer who will read it in the Decision Log. Two or three
sentences, concrete, no restating of the numbers they can already see. Say what the plan
gets right, what it misses, and why that matters for this particular application.`;

export async function critique(
  ctx: AgentContext,
  req: { attempt: number; scenarios: Scenario[]; recon: ReconResult },
): Promise<Critique> {
  const tier = models.critic;

  const previousScore = await readPreviousScore(ctx);

  const out = await runStructured(ctx, {
    as: "critic",
    name: "Coverage Critic",
    tier,
    instructions: INSTRUCTIONS,
    input: buildInput(req),
    outputType: critiqueSchema,
    maxTurns: 4,
  });

  const result = toCritique(out, req.attempt, previousScore);
  await writeArtifact(ctx.runId, "critique.json", JSON.stringify(result, null, 2));
  return result;
}

function buildInput(req: {
  attempt: number;
  scenarios: Scenario[];
  recon: ReconResult;
}): string {
  const byKind = req.scenarios.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1;
    return acc;
  }, {});

  return [
    `Plan revision: ${req.attempt}`,
    "",
    "Recon map — this is your ground truth:",
    `Routes (${req.recon.routes.length}): ${req.recon.routes.join(", ")}`,
    `Authenticated session: ${req.recon.authenticated ? "yes" : "no"}`,
    "Observations:",
    ...req.recon.evidence.map((e) => `- ${e.summary}${e.detail ? ` (${e.detail})` : ""}`),
    "",
    `Plan under review — ${req.scenarios.length} scenarios (${Object.entries(byKind)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")}):`,
    "---",
    JSON.stringify(req.scenarios, null, 2),
    "---",
  ].join("\n");
}

/**
 * The previous revision's score, so the orchestrator can show "62 → 81 after one
 * re-plan". Read off the artifact the last pass wrote; absent on the first pass.
 */
async function readPreviousScore(ctx: AgentContext): Promise<number | undefined> {
  try {
    const prior = JSON.parse(
      await readFile(runPath(ctx.runId, "critique.json"), "utf8"),
    ) as Critique;
    return typeof prior.score === "number" ? prior.score : undefined;
  } catch {
    return undefined;
  }
}
