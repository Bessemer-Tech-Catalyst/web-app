/**
 * The gate on the PRD traceability matrix.
 *
 * PRD-to-test-plan gap analysis is one of the brief's two Bonus items, and it is the
 * easiest thing in this project to produce a convincing fake of: ask a model to map a
 * requirements document onto a test plan and it will return a tidy matrix of ticks. Two
 * things go wrong, silently, and both of them make the matrix worse than having none.
 *
 *   1. **Invented scenario ids.** A model that cannot find a scenario for REQ-6 will
 *      sometimes cite one anyway. A tick backed by an id the plan does not contain is
 *      not a weak claim, it is a false one, so those references are struck out here and
 *      counted — an extraction that invents three references is telling you something
 *      about how much to trust the other forty.
 *
 *   2. **Confusing a plan with evidence.** This is the important one. A requirement
 *      mapped to a scenario that was quarantined, or that never became a running test,
 *      has *no test behind it*. Reporting that as covered is precisely the failure the
 *      whole product argues against: the plan is an intention, and only a test that ran
 *      is evidence.
 *
 * So coverage is resolved downward, from the model's mapping through what the run
 * actually did, into four states. `covered` stays a boolean because it is what the UI
 * and every saved report already read; `status` is the honest four-way answer.
 *
 * Deliberately dependency-free so `prd-gate.test.mts` can load the real thing.
 */

import type { PrdRequirement, Scenario, TestResult } from "@/lib/types";
import { resultFor } from "../../lib/report-join.ts";

/** One requirement as the model returned it, before anything has been checked. */
export interface TracedRequirement {
  id: string;
  text: string;
  /** Verbatim from the PRD, so a reader can check the extraction against the document. */
  quote: string;
  /** Scenario ids the model believes cover it. Verified below. */
  coveredBy: string[];
}

export interface GateResult {
  requirements: PrdRequirement[];
  /** `${requirementId} → ${scenarioId}` for every reference the plan does not contain. */
  invented: string[];
}

/**
 * Resolve a model's mapping against the plan and the run's results.
 *
 * `scenarios` is the plan as generated. `results` is every result the run recorded,
 * including the quarantine placeholders — a scenario with no result at all never
 * reached the runner either, and both cases land on `planned-only`.
 */
export function gateTrace(
  traced: TracedRequirement[],
  scenarios: Scenario[],
  results: TestResult[],
): GateResult {
  const known = new Set(scenarios.map((s) => s.id));
  const invented: string[] = [];

  const requirements = traced.map((req) => {
    const real: string[] = [];
    for (const id of dedupe(req.coveredBy)) {
      if (known.has(id)) real.push(id);
      else invented.push(`${req.id} → ${id}`);
    }

    const statuses = real.map((id) => resultFor(results, id)?.status);
    const status = resolve(real.length, statuses);

    return {
      id: req.id,
      text: req.text,
      quote: req.quote || undefined,
      coveredBy: real,
      status,
      // A requirement is covered when a test that ran stands behind it. Green or red,
      // there is evidence; a plan alone is not evidence and never says `covered: true`.
      covered: status === "proven" || status === "exercised",
    } satisfies PrdRequirement;
  });

  return { requirements, invented };
}

/** The four-way answer, resolved from the strongest evidence any mapped scenario has. */
function resolve(
  mapped: number,
  statuses: (string | undefined)[],
): PrdRequirement["status"] {
  if (mapped === 0) return "uncovered";
  if (statuses.some((s) => s === "passed" || s === "healed")) return "proven";
  if (statuses.some((s) => s === "failed")) return "exercised";
  return "planned-only";
}

/**
 * Scenarios no requirement claims.
 *
 * The matrix reads in one direction by default — requirements down, tests across — and
 * the other direction is worth a line too. A scenario tracing to nothing is either
 * coverage the PRD forgot to ask for, or scope the team did not intend to build.
 */
export function untracedScenarios(
  requirements: PrdRequirement[],
  scenarios: Scenario[],
): string[] {
  const claimed = new Set(requirements.flatMap((r) => r.coveredBy));
  return scenarios.filter((s) => !claimed.has(s.id)).map((s) => s.id);
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
}
