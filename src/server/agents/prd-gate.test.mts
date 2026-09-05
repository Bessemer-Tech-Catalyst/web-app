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
import { gateTrace, quoteAppearsIn, type TracedRequirement, untracedScenarios } from "./prd-gate.ts";
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

// ---------------------------------------------------------------------------
// Quote verification — added after run_6f0284ae, where every quote was real and
// none of them would have grepped.
// ---------------------------------------------------------------------------

test("a quote the model reflowed across the document's line wrap still verifies", () => {
  const document = "**1.1 Sign in.** A shopper signs in with an email address and a password. On\nsuccess the application places the shopper on the catalogue.";
  assert.equal(
    quoteAppearsIn("A shopper signs in with an email address and a password. On success the application places the shopper on the catalogue.", document),
    true,
    "the wrap is the document's formatting, not a difference in what the quote says",
  );
});

test("typographic quotes and dashes a model reflowed are not a mismatch", () => {
  const document = `The page must say "unavailable" - not render as empty.`;
  assert.equal(quoteAppearsIn('The page must say “unavailable” — not render as empty.', document), true);
});

test("a quote the document does not contain is rejected", () => {
  const document = "A shopper signs in with an email address and a password.";
  assert.equal(quoteAppearsIn("A shopper signs in with a one-time passcode sent by SMS.", document), false);
});

test("a quote too short to be evidence does not count as verified", () => {
  assert.equal(quoteAppearsIn("sign in", "A shopper signs in with an email address."), false);
});

test("an unverifiable quote is dropped from the requirement, and counted", () => {
  const document = "1.1 A shopper signs in with an email address and a password.";
  const { requirements, misquoted } = gateTrace(
    [
      { id: "1.1", text: "Sign in", quote: "A shopper signs in with an email address and a password.", coveredBy: ["s1"] },
      { id: "1.2", text: "Reset", quote: "A shopper resets a password with a link sent by email.", coveredBy: [] },
    ],
    [{ id: "s1" } as never],
    [],
    document,
  );
  assert.deepEqual(misquoted, ["1.2"]);
  assert.equal(requirements[0].quote, "A shopper signs in with an email address and a password.");
  assert.equal(requirements[1].quote, undefined, "a citation a reader cannot check is worse than none");
  assert.equal(requirements[1].id, "1.2", "the requirement itself is still reported");
});

test("with no document supplied, quotes are carried rather than struck", () => {
  const { requirements, misquoted } = gateTrace(
    [{ id: "1.1", text: "Sign in", quote: "Whatever the model said it read.", coveredBy: [] }],
    [],
    [],
  );
  assert.deepEqual(misquoted, []);
  assert.equal(requirements[0].quote, "Whatever the model said it read.");
});
