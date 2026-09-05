/**
 * What to do when the Generator emits nothing.
 *
 * A plan can pass the Coverage Critic and still be unbuildable. `run_90f1c9f5` is the
 * worked example: five scenarios, scored 84/100, every one of them quarantined once the
 * Generator walked the live application — they asked for failure states no control on
 * the page can produce, and for an account with an empty order history that does not
 * exist. Execute then ran an empty suite, Triage had no failures to classify, Heal had
 * nothing to repair, and the run published a report about nothing. Every stage behaved
 * correctly. The run was still worthless.
 *
 * The missing judgment is the one the brief names first — *when to re-plan* — and it is
 * kept here, out of the state machine's body, because it is the kind of judgment that
 * has to be checkable without a browser, a model or a key.
 *
 * The rule: a plan that produced no evidence at all is a planning failure, and planning
 * failures are what the re-plan allowance is for. The quarantine reasons become the
 * directives, because they are the only record of what the live application refused to
 * give — which is exactly what the next plan must stop asking for.
 */

import type { Gap } from "@/lib/types";

export interface QuarantinedScenario {
  scenarioId: string;
  title: string;
  reason: string;
}

export interface GenerationOutcomeInput {
  /** How many tests the Generator actually emitted. */
  emitted: number;
  quarantined: QuarantinedScenario[];
  /** Which plan attempt produced this generation. The first attempt is 1. */
  attempt: number;
  maxReplans: number;
  overBudget: boolean;
}

export type GenerationVerdict =
  | { action: "proceed" }
  | { action: "replan"; directives: Gap[] }
  | { action: "escalate"; because: "allowance-spent" | "over-budget" };

/**
 * One emitted test is enough to proceed.
 *
 * Deliberately not a threshold. "Fewer than half the scenarios built, so re-plan" trades
 * a suite that exists for a suite that might be bigger, and the run's own quarantine
 * reasons are usually right that the rest are unreachable. Nothing at all is a different
 * kind of event: there is no evidence to report either way.
 */
export function afterGeneration(input: GenerationOutcomeInput): GenerationVerdict {
  if (input.emitted > 0) return { action: "proceed" };
  if (input.overBudget) return { action: "escalate", because: "over-budget" };
  if (input.attempt > input.maxReplans) return { action: "escalate", because: "allowance-spent" };
  return { action: "replan", directives: unbuildableDirectives(input.quarantined) };
}

/**
 * The quarantine reasons, as directives the Planner already knows how to revise against.
 *
 * They are carried verbatim. A summarised reason ("could not be reached") tells the next
 * plan nothing it can act on; the Generator's own sentence names the control it looked
 * for and where it looked.
 */
export function unbuildableDirectives(quarantined: QuarantinedScenario[]): Gap[] {
  return quarantined.map((q) => ({
    id: `unbuildable-${q.scenarioId}`,
    title: `"${q.title}" could not be built against the live application`,
    dimension: "flow-completeness" as const,
    severity: "high" as const,
    rationale:
      `The Generator walked the application and quarantined this scenario: ${q.reason} ` +
      "Re-scope it to a state the application actually exposes, or replace it with a flow that can be reached.",
  }));
}
