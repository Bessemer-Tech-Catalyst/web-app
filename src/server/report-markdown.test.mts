/**
 * The Markdown report — the deliverable a team actually reviews.
 *
 * What is pinned here is not formatting, it is honesty. Every case below is a sentence
 * this document must not say:
 *
 *   - it must not report a `planned-only` requirement as covered
 *   - it must not imply red tests were understood when nothing classified them
 *   - it must not read as a pass when no test executed
 *   - it must not let a pipe character in a scenario title silently eat a table column,
 *     which is how a row of a coverage table goes missing without anything looking wrong
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { reportMarkdown } from "./report-markdown.ts";
import type { TestQualityReport } from "@/lib/types";

const base: TestQualityReport = {
  runId: "run_abc123",
  url: "https://shop.test",
  startedAt: "2026-09-05T10:00:00.000Z",
  finishedAt: "2026-09-05T10:09:00.000Z",
  durationMs: 540_000,
  costUsd: 0.161,
  coverageScore: 82,
  scenariosPlanned: 3,
  scenariosGenerated: 3,
  scenariosQuarantined: 0,
  passed: 2,
  failed: 1,
  healed: 0,
  replans: 1,
  healAttempts: 0,
  scenarios: [],
  results: [],
  triage: [],
  heals: [],
  bugs: [],
  remainingGaps: [],
  risks: [],
};

const report = (over: Partial<TestQualityReport> = {}): TestQualityReport => ({ ...base, ...over });

test("the headline carries the run, the target, the clock and the bill", () => {
  const md = reportMarkdown(report());
  assert.match(md, /# Test quality report — https:\/\/shop\.test/);
  assert.match(md, /run `run_abc123`/);
  assert.match(md, /9m 00s/);
  assert.match(md, /\$0\.161/);
});

test("a run that executed nothing says so before anything else can read as a pass", () => {
  const md = reportMarkdown(report({ passed: 0, failed: 0, healed: 0 }));
  assert.match(md, /This run executed no tests/);
});

test("a run that executed something does not carry that warning", () => {
  assert.doesNotMatch(reportMarkdown(report()), /This run executed no tests/);
});

test("red tests with no classifier verdict are not implied to be understood", () => {
  const md = reportMarkdown(report({ triage: [], bugs: [] }));
  assert.match(md, /No failure reached the defect classifier in this run/);
});

test("a planned-only requirement is printed as having no test, never as covered", () => {
  const md = reportMarkdown(
    report({
      prd: [
        { id: "REQ-1", text: "Users can sign in", covered: true, coveredBy: ["signin"], status: "proven" },
        { id: "REQ-2", text: "Password reset works", covered: false, coveredBy: ["reset"], status: "planned-only" },
        { id: "REQ-3", text: "Declines preserve the cart", covered: false, coveredBy: [], status: "uncovered" },
      ],
    }),
  );
  assert.match(md, /REQ-2.*planned, never ran/);
  assert.match(md, /REQ-3.*no test/);
  assert.match(md, /1 of 3 stated requirements have a test that ran behind them/);
});

test("an exercised requirement is distinguished from a proven one", () => {
  const md = reportMarkdown(
    report({
      prd: [{ id: "R1", text: "x", covered: true, coveredBy: ["a"], status: "exercised" }],
    }),
  );
  assert.match(md, /exercised \(test is red\)/);
});

test("the risk table prints the computed score alongside any adjusted one", () => {
  const md = reportMarkdown(
    report({
      risks: [
        {
          id: "r1",
          surface: "/forgot-password",
          risk: "high",
          score: 60,
          priorScore: 52,
          status: "untested",
          reasons: ["Touches credentials", "Named in the PRD"],
        },
      ],
    }),
  );
  assert.match(md, /\/forgot-password/);
  assert.match(md, /60 \(computed 52\)/);
});

test("a pipe in a title is escaped, so it cannot eat a table column", () => {
  const md = reportMarkdown(
    report({
      scenarios: [
        {
          id: "s1",
          title: "Sign in | sign out",
          flow: "Auth",
          kind: "happy-path",
          priority: "high",
          steps: [],
          expected: "",
        },
      ],
      results: [
        { id: "s1-1", testId: "s1", title: "Sign in | sign out", status: "passed", durationMs: 10, attempt: 1 },
      ],
    }),
  );
  const row = md.split("\n").find((l) => l.includes("Sign in")) ?? "";
  assert.match(row, /Sign in \\\| sign out/);
  // Six columns means seven *unescaped* pipes. The escaped one is still a `|` character,
  // so the count has to skip it — which is the whole point of escaping it.
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 7);
});

test("a scenario's outcome is joined the same way the UI joins it", () => {
  const md = reportMarkdown(
    report({
      scenarios: [
        { id: "orders", title: "Orders", flow: "Orders", kind: "happy-path", priority: "high", steps: [], expected: "" },
      ],
      // The real Generator's convention: the test is named after its scenario.
      results: [{ id: "orders-1", testId: "orders", title: "Orders", status: "failed", durationMs: 90_000, attempt: 1 }],
      triage: [
        { testId: "orders", verdict: "APP_DEFECT", confidence: 0.94, rationale: "500", evidence: [] },
      ],
    }),
  );
  assert.match(md, /\| FAIL \| APP_DEFECT \(0\.94\)/);
});

test("a rejected patch is labelled as rejected, not summarised as a heal", () => {
  const md = reportMarkdown(
    report({
      heals: [
        {
          testId: "signin",
          attempt: 1,
          summary: "Retargeted the submit button",
          before: 'await expect(page.getByRole("alert")).toHaveText("Invalid");',
          after: 'await expect(page.getByRole("alert")).toBeVisible();',
          assertionsIntact: false,
          outcome: "rejected",
        },
      ],
    }),
  );
  assert.match(md, /\*\*rejected\*\*/);
  assert.match(md, /Rejected by the assertion-integrity guard/);
});

test("the coverage working prints the denominator the other numbers rest on", () => {
  const md = reportMarkdown(
    report({
      surfaces: [
        { surface: "/", status: "exercised", scenarios: ["s1"], tests: ["s1"], signal: "navigation", basis: "1 executed test(s) navigate to /" },
        { surface: "/forgot-password", status: "untested", scenarios: [], tests: [], signal: "none" },
      ],
    }),
  );
  assert.match(md, /1 of 2 discovered surfaces were exercised/);
  assert.match(md, /No scenario named it and no emitted test reaches it|\| none \|/);
});
