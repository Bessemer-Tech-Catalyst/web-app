/**
 * The gate on the PRD traceability matrix — the brief's first Bonus item.
 *
 * Two failures are pinned here, and both of them would ship as a tidy, convincing table.
 *
 * **An invented scenario id must not become a tick.** A model that cannot find a
 * scenario for a requirement will sometimes cite one anyway; a reference the plan does
 * not contain is a false claim, not a weak one.
 *
 * **A plan is not evidence.** A requirement mapped to a scenario that was quarantined has
 * no test behind it. Reporting it as covered is the exact failure the rest of this
 * product argues against, and it is invisible in the rendered matrix.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { gateTrace, untracedScenarios, type TracedRequirement } from "./prd-gate.ts";
import type { Scenario, TestResult } from "@/lib/types";

const scenario = (id: string): Scenario => ({
  id,
  title: id,
  flow: "Flow",
  kind: "happy-path",
  priority: "high",
  steps: [],
  expected: "",
});

const result = (testId: string, status: TestResult["status"]): TestResult => ({
  id: `${testId}-1`,
  testId,
  title: testId,
  status,
  durationMs: 10,
  attempt: 1,
});

const req = (id: string, coveredBy: string[]): TracedRequirement => ({
  id,
  text: `${id} text`,
  quote: `${id} quote`,
  coveredBy,
});

const PLAN = [scenario("signin"), scenario("checkout"), scenario("reset")];

test("a requirement whose test passed is proven", () => {
  const { requirements } = gateTrace([req("REQ-1", ["signin"])], PLAN, [result("signin", "passed")]);
  assert.equal(requirements[0].status, "proven");
  assert.equal(requirements[0].covered, true);
});

test("a healed test proves the requirement too — it ends green", () => {
  const { requirements } = gateTrace([req("REQ-1", ["signin"])], PLAN, [result("signin", "healed")]);
  assert.equal(requirements[0].status, "proven");
});

test("a red test is exercised, not proven — there is evidence, and it is bad", () => {
  const { requirements } = gateTrace([req("REQ-2", ["checkout"])], PLAN, [result("checkout", "failed")]);
  assert.equal(requirements[0].status, "exercised");
  assert.equal(requirements[0].covered, true);
});

test("a quarantined scenario leaves the requirement planned-only and NOT covered", () => {
  const { requirements } = gateTrace([req("REQ-3", ["reset"])], PLAN, [result("q-reset", "quarantined")]);
  assert.equal(requirements[0].status, "planned-only");
  assert.equal(requirements[0].covered, false);
});

test("a scenario that never reached the runner at all is planned-only, not covered", () => {
  const { requirements } = gateTrace([req("REQ-3", ["reset"])], PLAN, []);
  assert.equal(requirements[0].status, "planned-only");
  assert.equal(requirements[0].covered, false);
});

test("a requirement nothing maps to is uncovered", () => {
  const { requirements } = gateTrace([req("REQ-9", [])], PLAN, []);
  assert.equal(requirements[0].status, "uncovered");
  assert.equal(requirements[0].covered, false);
});

test("an invented scenario id is struck out and counted, never rendered as a tick", () => {
  const { requirements, invented } = gateTrace(
    [req("REQ-6", ["scenario-that-does-not-exist"])],
    PLAN,
    [result("signin", "passed")],
  );
  assert.deepEqual(requirements[0].coveredBy, []);
  assert.equal(requirements[0].status, "uncovered");
  assert.deepEqual(invented, ["REQ-6 → scenario-that-does-not-exist"]);
});

test("real references survive alongside invented ones, and the strongest evidence wins", () => {
  const { requirements, invented } = gateTrace(
    [req("REQ-1", ["ghost", "checkout", "signin"])],
    PLAN,
    [result("checkout", "failed"), result("signin", "passed")],
  );
  assert.deepEqual(requirements[0].coveredBy, ["checkout", "signin"]);
  assert.equal(requirements[0].status, "proven");
  assert.deepEqual(invented, ["REQ-1 → ghost"]);
});

test("a duplicated reference is counted once", () => {
  const { requirements } = gateTrace(
    [req("REQ-1", ["signin", "signin", " signin "])],
    PLAN,
    [result("signin", "passed")],
  );
  assert.deepEqual(requirements[0].coveredBy, ["signin"]);
});

test("the verbatim quote is carried through, so the extraction can be checked", () => {
  const { requirements } = gateTrace([req("REQ-1", ["signin"])], PLAN, []);
  assert.equal(requirements[0].quote, "REQ-1 quote");
});

test("scenarios no requirement claims are reported — the matrix reads both ways", () => {
  const { requirements } = gateTrace([req("REQ-1", ["signin"])], PLAN, [result("signin", "passed")]);
  assert.deepEqual(untracedScenarios(requirements, PLAN), ["checkout", "reset"]);
});
