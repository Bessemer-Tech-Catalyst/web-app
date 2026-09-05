/**
 * The regression test for the scenario-to-result join.
 *
 * The defect this pins: the report's "Scenarios covered" table — the first thing the
 * brief's final-report requirement names — looked results up by `t-${scenario.id}`. Only
 * `fixtures.ts` ever produced that shape. The real Generator sets `GeneratedTest.id` to
 * the scenario's own id, so on every live run the lookup missed every row and a suite
 * that had fully executed was rendered as `pending` from top to bottom.
 *
 * It is the same shape of bug as `report-keys.test.mts` pins for the Playwright report,
 * and it fails the same way: not loudly, but as a plausible-looking table.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { idsFor, isFor, resultFor, triageFor } from "./report-join.ts";
import type { TestResult, TriageOutcome } from "./types.ts";

const result = (testId: string, status: TestResult["status"], attempt = 1): TestResult => ({
  id: `${testId}-${attempt}`,
  testId,
  title: testId,
  status,
  durationMs: 10,
  attempt,
});

test("the real Generator's id — the scenario id itself — matches", () => {
  assert.equal(isFor("checkout-happy-path", "checkout-happy-path"), true);
});

test("the fixture prefix still matches, because saved runs carry it", () => {
  assert.equal(isFor("t-s1", "s1"), true);
  assert.equal(isFor("q-s1", "s1"), true);
});

test("a different scenario does not match, prefix or not", () => {
  assert.equal(isFor("t-s10", "s1"), false);
  assert.equal(isFor("checkout", "checkout-happy-path"), false);
});

test("idsFor lists every convention exactly once", () => {
  assert.deepEqual(idsFor("s1"), ["s1", "t-s1", "q-s1"]);
});

test("a scenario's outcome is found under the unprefixed id", () => {
  const results = [result("signin", "passed"), result("checkout", "failed")];
  assert.equal(resultFor(results, "checkout")?.status, "failed");
});

test("the last result wins, so a heal's re-run beats the failure it replaced", () => {
  const results = [result("checkout", "failed", 1), result("checkout", "healed", 2)];
  assert.equal(resultFor(results, "checkout")?.status, "healed");
  assert.equal(resultFor(results, "checkout")?.attempt, 2);
});

test("a quarantine placeholder is found for the scenario it holds", () => {
  const results = [result("q-password-reset", "quarantined")];
  assert.equal(resultFor(results, "password-reset")?.status, "quarantined");
});

test("a scenario with no result at all resolves to undefined, not to another row", () => {
  assert.equal(resultFor([result("signin", "passed")], "checkout"), undefined);
});

test("a triage verdict is found under whichever id the classifier recorded", () => {
  const triage = [
    { testId: "orders", verdict: "APP_DEFECT", confidence: 0.94, rationale: "", evidence: [] },
  ] as TriageOutcome[];
  assert.equal(triageFor(triage, "orders")?.verdict, "APP_DEFECT");
  assert.equal(triageFor(triage, "signin"), undefined);
});
