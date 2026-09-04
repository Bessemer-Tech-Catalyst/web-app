/**
 * The test for the classification prior — the rules the defect classifier has to argue
 * against rather than start from nothing.
 *
 * The error texts below are Playwright's own, in the shapes it actually emits. They are
 * the whole input to this layer, so a change to the parsing that stops recognising one
 * of them silently turns a confident verdict into the "no known failure shape" fallback
 * — which is why every shape gets a case here rather than one representative sample.
 *
 * The case that matters most is `assertion-failed` on a proven locator. That is the one
 * that says APP_DEFECT, and APP_DEFECT is the verdict that withholds the Healer and
 * files a bug: getting it wrong in one direction leaves a real defect unreported, and in
 * the other leaves a healthy test red with a bug filed against nothing.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { correlate, priorVerdict, readSignals } from "./failure-signals.ts";

// --- The error texts, verbatim in shape ------------------------------------

const LOCATOR_TIMEOUT = `TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Add to cart' })
`;

const ASSERTION = `Error: expect(locator).toHaveText(expected)

Locator: getByTestId('cart-badge')
Expected string: "1"
Received string: "0"
Call log:
  - expect.toHaveText with timeout 5000ms
`;

const STRICT_MODE = `Error: strict mode violation: getByTestId('todo-title') resolved to 2 elements:
    1) <span>Recon sample</span>
    2) <span>Buy milk</span>
`;

const INTERCEPTED = `TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'New appointment' })
  - locator resolved to <button class="btn">New appointment</button>
  - attempting click action
  - <nav class="sidebar">…</nav> intercepts pointer events
`;

const NAVIGATION = `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3999/
`;

const NO_RUN = `The test runner did not run this file: Error: Cannot find module './helpers'`;

// --- Reading the runner ----------------------------------------------------

test("a locator timeout names the locator it waited for", () => {
  const s = readSignals(LOCATOR_TIMEOUT);
  assert.deepEqual(s.kinds, ["locator-timeout"]);
  assert.equal(s.locator, "getByRole('button', { name: 'Add to cart' })");
});

test("an assertion failure is read as an assertion, not as a timeout", () => {
  const s = readSignals(ASSERTION);
  assert.ok(s.kinds.includes("assertion-failed"));
  assert.ok(!s.kinds.includes("locator-timeout"), "the element was found; this is not a wait that expired");
  assert.equal(s.matcher, "toHaveText");
  assert.equal(s.locator, "getByTestId('cart-badge')");
  assert.equal(s.expected, '"1"');
  assert.equal(s.received, '"0"');
});

test("a strict-mode violation carries the ambiguous locator", () => {
  const s = readSignals(STRICT_MODE);
  assert.ok(s.kinds.includes("strict-mode"));
  assert.equal(s.locator, "getByTestId('todo-title')");
});

test("an intercepted click is distinguished from an element that never appeared", () => {
  const s = readSignals(INTERCEPTED);
  assert.ok(s.kinds.includes("pointer-intercepted"));
  assert.equal(s.locator, "getByRole('button', { name: 'New appointment' })");
});

test("a failed navigation is recognised without a locator", () => {
  const s = readSignals(NAVIGATION);
  assert.deepEqual(s.kinds, ["navigation-failed"]);
  assert.equal(s.locator, undefined);
});

test("a file that never loaded is recognised as such", () => {
  assert.ok(readSignals(NO_RUN).kinds.includes("did-not-run"));
});

// --- The prior -------------------------------------------------------------

const prior = (error: string, locatorWasProven?: boolean, alsoFailing: string[] = []) =>
  priorVerdict({ signals: readSignals(error), locatorWasProven, alsoFailing });

test("a found element holding the wrong value is the application's answer", () => {
  const p = prior(ASSERTION, true);
  assert.equal(p.verdict, "APP_DEFECT");
  assert.ok(p.confidence >= 0.55);
  assert.match(p.why, /toHaveText/);
});

test("a locator that resolved at generation time and cannot be found now is drift", () => {
  const p = prior(LOCATOR_TIMEOUT, true);
  assert.equal(p.verdict, "SCRIPT_DRIFT");
  assert.ok(p.confidence > prior(LOCATOR_TIMEOUT, false).confidence, "provenance is what makes this confident");
});

test("an ambiguous locator is the script's problem, never the app's", () => {
  assert.equal(prior(STRICT_MODE, true).verdict, "SCRIPT_DRIFT");
});

test("an unreachable target is the environment, not a defect in a page that loaded", () => {
  assert.equal(prior(NAVIGATION).verdict, "ENV_FLAKE");
});

test("a file the runner could not load says nothing about the application", () => {
  const p = prior(NO_RUN);
  assert.equal(p.verdict, "SCRIPT_DRIFT");
  assert.match(p.why, /never reached the browser/);
});

test("no prior is ever confident enough to stand on its own", () => {
  for (const error of [LOCATOR_TIMEOUT, ASSERTION, STRICT_MODE, INTERCEPTED, NAVIGATION, NO_RUN]) {
    for (const proven of [true, false, undefined]) {
      const p = prior(error, proven);
      assert.ok(
        p.confidence <= 0.75,
        `a rules-only verdict claimed ${p.confidence}; the prior has not looked at the application`,
      );
    }
  }
});

test("an unrecognised failure falls through weakly rather than guessing loudly", () => {
  const p = prior("Error: something went wrong");
  assert.ok(p.confidence <= 0.35);
});

// --- Cross-test correlation ------------------------------------------------

test("tests failing on the same locator are correlated to each other", () => {
  const failures = [
    { testId: "t-1", signals: readSignals(LOCATOR_TIMEOUT) },
    { testId: "t-2", signals: readSignals(LOCATOR_TIMEOUT) },
    { testId: "t-3", signals: readSignals(ASSERTION) },
  ];
  const map = correlate(failures);
  assert.deepEqual(map.get("t-1"), ["t-2"]);
  assert.deepEqual(map.get("t-2"), ["t-1"]);
  assert.deepEqual(map.get("t-3"), []);
});

test("a failure with no locator correlates with nothing", () => {
  const map = correlate([
    { testId: "t-1", signals: readSignals(NAVIGATION) },
    { testId: "t-2", signals: readSignals(NAVIGATION) },
  ]);
  assert.deepEqual(map.get("t-1"), []);
});
