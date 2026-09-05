/**
 * The re-plan gate, pinned.
 *
 * Every case here is a run that has already happened or is one flag away from happening.
 * The one that matters most is the last: a run whose allowance is spent must escalate
 * rather than loop, because an orchestrator that re-plans forever is a hung demo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { afterGeneration, unbuildableDirectives } from "./regenerate.ts";

const quarantined = [
  { scenarioId: "orders-error", title: "Show an order-history error", reason: "No control produces the failure." },
  { scenarioId: "auth-reset", title: "Reset a forgotten password", reason: "No reset link exists on the sign-in page." },
];

test("one emitted test is enough to proceed — a small suite is still a suite", () => {
  const verdict = afterGeneration({ emitted: 1, quarantined, attempt: 1, maxReplans: 2, overBudget: false });
  assert.deepEqual(verdict, { action: "proceed" });
});

test("nothing emitted, with allowance left, re-plans against the quarantine reasons", () => {
  const verdict = afterGeneration({ emitted: 0, quarantined, attempt: 1, maxReplans: 2, overBudget: false });
  assert.equal(verdict.action, "replan");
  assert.equal(verdict.action === "replan" && verdict.directives.length, 2);
});

test("the directives carry the Generator's own sentence, not a summary of it", () => {
  const [first] = unbuildableDirectives(quarantined);
  assert.match(first.rationale, /No control produces the failure\./);
  assert.match(first.title, /Show an order-history error/);
  assert.equal(first.severity, "high");
  assert.equal(first.id, "unbuildable-orders-error");
});

test("a spent re-plan allowance escalates instead of looping forever", () => {
  const verdict = afterGeneration({ emitted: 0, quarantined, attempt: 3, maxReplans: 2, overBudget: false });
  assert.deepEqual(verdict, { action: "escalate", because: "allowance-spent" });
});

test("the last attempt permitted by the allowance still gets to re-plan", () => {
  const verdict = afterGeneration({ emitted: 0, quarantined, attempt: 2, maxReplans: 2, overBudget: false });
  assert.equal(verdict.action, "replan");
});

test("maxReplans of 0 means the first empty generation escalates", () => {
  const verdict = afterGeneration({ emitted: 0, quarantined, attempt: 1, maxReplans: 0, overBudget: false });
  assert.deepEqual(verdict, { action: "escalate", because: "allowance-spent" });
});

test("being over budget escalates even with allowance left — money is the harder ceiling", () => {
  const verdict = afterGeneration({ emitted: 0, quarantined, attempt: 1, maxReplans: 2, overBudget: true });
  assert.deepEqual(verdict, { action: "escalate", because: "over-budget" });
});

test("an over-budget run that did emit tests still proceeds to run them", () => {
  const verdict = afterGeneration({ emitted: 2, quarantined: [], attempt: 1, maxReplans: 2, overBudget: true });
  assert.deepEqual(verdict, { action: "proceed" }, "the suite is paid for; refusing to run it wastes the spend");
});
