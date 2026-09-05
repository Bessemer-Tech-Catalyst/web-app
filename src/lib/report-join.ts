/**
 * The join between a planned scenario and what actually happened to it.
 *
 * This is one function because it was two, and they disagreed. The report's
 * "Scenarios covered" table — which is the first thing the brief's final-report
 * requirement names — looked its results up by `t-${scenario.id}`, a shape only
 * `fixtures.ts` ever produced. The real Generator sets `GeneratedTest.id` to the
 * scenario's own id, so on every live run that lookup missed every row and the table
 * reported a fully-executed suite as `pending` from top to bottom.
 *
 * That is the same defect class as `report-keys.ts` — a key mismatch between two halves
 * of the pipeline, invisible because the failure mode is a plausible-looking table — so
 * it gets the same treatment: one exported matcher, pinned by a test.
 *
 * The prefixes are tolerated rather than required. Nothing emits `t-` any more, but the
 * fixtures do, saved runs on disk carry whatever convention was current when they ran,
 * and a report is read long after the code that wrote it.
 */

import type { Scenario, TestResult, TriageOutcome } from "./types";

/** Every id under which a result for this scenario may have been recorded. */
export function idsFor(scenarioId: string): string[] {
  return [scenarioId, `t-${scenarioId}`, `q-${scenarioId}`];
}

/** True when `testId` identifies work done for `scenarioId`, under any convention. */
export function isFor(testId: string, scenarioId: string): boolean {
  return idsFor(scenarioId).includes(testId);
}

/**
 * The outcome recorded for a scenario.
 *
 * A scenario can hold more than one result — the first pass, a flake retry, a re-run
 * after a heal — and the *last* one is the one that stands, because that is the order
 * the orchestrator wrote them in. Preferring an executed result over a quarantine
 * placeholder is not needed: a scenario is either emitted or quarantined, never both.
 */
export function resultFor(
  results: TestResult[],
  scenarioId: string,
): TestResult | undefined {
  let found: TestResult | undefined;
  for (const r of results) if (isFor(r.testId, scenarioId)) found = r;
  return found;
}

export function triageFor(
  triage: TriageOutcome[],
  scenarioId: string,
): TriageOutcome | undefined {
  return triage.find((t) => isFor(t.testId, scenarioId));
}

/** Scenario ids the plan actually contains — used to reject invented references. */
export function scenarioIndex(scenarios: Scenario[]): Map<string, Scenario> {
  return new Map(scenarios.map((s) => [s.id, s]));
}
