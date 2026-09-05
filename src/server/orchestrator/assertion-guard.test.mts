/**
 * The assertion-integrity guard, pinned against real patches — including the one that
 * exposed a genuine bug in the pairing algorithm during a live run against ShopLite
 * (`run_0aa69767`, `complete-checkout-with-session-basket.spec.ts`).
 *
 * That run's last assertion was ambiguous — `page.getByRole("cell", { name: "× Copper
 * stovetop kettle" })` matched three order rows, because ShopLite's orders page shows
 * full history and persists across runs. Triage correctly called it SCRIPT_DRIFT. The
 * Healer's fix was correct: scope the locator to the row for the order just placed by
 * appending `.first()` (the newest order renders first). The guard rejected it anyway,
 * reporting "expected value changed" — a false positive. The cause: the test's ninth
 * assertion happens to repeat the same subject text as its fourth (`page.getByRole("cell",
 * { name: "£" })`, once on the basket page and once on the orders page), and the old
 * fallback-pairing index (`Math.min(i, pool.length - 1)`) used the assertion's position in
 * the *original* array once a subject changed, rather than its position in the *shrunk*
 * pool — so it paired the changed assertion against an unrelated, untouched one nine
 * lines later and reported their different `expected` values as a change.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { checkAssertionIntegrity, parseAssertions } from "./assertion-guard.ts";

test("parses subject, matcher, negation and expected value", () => {
  const [a] = parseAssertions(`await expect(page.getByText("Hi")).toBeVisible();`);
  assert.equal(a.subject, `page.getByText("Hi")`);
  assert.equal(a.matcher, "toBeVisible");
  assert.equal(a.negated, false);

  const [b] = parseAssertions(`await expect(page).not.toHaveURL("/login");`);
  assert.equal(b.negated, true);
  assert.equal(b.matcher, "toHaveURL");
});

test("an untouched file passes with nothing to say", () => {
  const src = `await expect(page.getByText("Hi")).toBeVisible();`;
  const verdict = checkAssertionIntegrity(src, src);
  assert.equal(verdict.intact, true);
  assert.deepEqual(verdict.violations, []);
});

test("rewriting only the locator inside expect() is always allowed", () => {
  const before = `await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();`;
  const after = `await expect(page.getByTestId("submit-btn")).toBeVisible();`;
  assert.equal(checkAssertionIntegrity(before, after).intact, true);
});

test("deleting an assertion is rejected", () => {
  const before = `
    await expect(page.getByText("A")).toBeVisible();
    await expect(page.getByText("B")).toBeVisible();
  `;
  const after = `await expect(page.getByText("A")).toBeVisible();`;
  const v = checkAssertionIntegrity(before, after);
  assert.equal(v.intact, false);
  assert.match(v.violations.join(" "), /1 assertion\(s\) deleted/);
});

test("weakening toHaveText to toBeVisible is rejected", () => {
  const before = `await expect(page.getByTestId("total")).toHaveText("£84.00");`;
  const after = `await expect(page.getByTestId("total")).toBeVisible();`;
  const v = checkAssertionIntegrity(before, after);
  assert.equal(v.intact, false);
  assert.match(v.violations.join(" "), /matcher weakened/);
});

test("flipping a negation is rejected", () => {
  const before = `await expect(page.getByText("Error")).not.toBeVisible();`;
  const after = `await expect(page.getByText("Error")).toBeVisible();`;
  const v = checkAssertionIntegrity(before, after);
  assert.equal(v.intact, false);
  assert.match(v.violations.join(" "), /negation flipped/);
});

test("changing the expected value on an untouched locator is rejected", () => {
  const before = `await expect(page.getByTestId("total")).toHaveText("£84.00");`;
  const after = `await expect(page.getByTestId("total")).toHaveText("£0.00");`;
  const v = checkAssertionIntegrity(before, after);
  assert.equal(v.intact, false);
  assert.match(v.violations.join(" "), /expected value changed/);
});

/**
 * The regression. This is `complete-checkout-with-session-basket.spec.ts` reduced to the
 * shape that matters: a `£84.00` cell subject repeated twice (basket total, then order
 * total), with the Healer narrowing the one assertion in between via `.first()`.
 *
 * Before the fix this reported two spurious "expected value changed" violations and
 * rejected a patch that changed no assertion's meaning at all.
 */
test("narrowing one ambiguous locator does not false-positive against a same-subject assertion elsewhere in the test", () => {
  const before = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
    await expect(page.getByTestId("basket-total")).toHaveText("£84.00");
    await expect(page.getByTestId("order-placed")).toHaveText(/Order SL-[A-Z0-9]+ placed/);
    await expect(
      page.getByRole("cell", { name: "× Copper stovetop kettle" })
    ).toHaveText("2× Copper stovetop kettle");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
  `;
  const after = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
    await expect(page.getByTestId("basket-total")).toHaveText("£84.00");
    await expect(page.getByTestId("order-placed")).toHaveText(/Order SL-[A-Z0-9]+ placed/);
    await expect(
      page.getByRole("cell", { name: "× Copper stovetop kettle" }).first()
    ).toHaveText("2× Copper stovetop kettle");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
  `;
  const v = checkAssertionIntegrity(before, after);
  assert.deepEqual(v.violations, []);
  assert.equal(v.intact, true);
});

/**
 * The same shape, but this time the narrowed assertion's *expected value* really is
 * different — the guard must still catch that. The fix must not have traded a false
 * positive for a false negative.
 */
test("a real expected-value change on the narrowed assertion is still caught", () => {
  const before = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
    await expect(
      page.getByRole("cell", { name: "× Copper stovetop kettle" })
    ).toHaveText("2× Copper stovetop kettle");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
  `;
  const after = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
    await expect(
      page.getByRole("cell", { name: "× Copper stovetop kettle" }).first()
    ).toHaveText("1× Copper stovetop kettle");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£84.00");
  `;
  const v = checkAssertionIntegrity(before, after);
  assert.equal(v.intact, false);
  assert.match(v.violations.join(" "), /expected value changed/);
});

/**
 * Three duplicate subjects, only the middle one narrowed — checks the fallback correctly
 * threads through more than one collision rather than only the two-duplicate case above.
 */
test("multiple repeated subjects around one narrowed assertion all still pair correctly", () => {
  const before = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£10.00");
    await expect(page.getByRole("cell", { name: "Item" })).toHaveText("Widget");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£20.00");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£30.00");
  `;
  const after = `
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£10.00");
    await expect(page.getByRole("cell", { name: "Item" }).first()).toHaveText("Widget");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£20.00");
    await expect(page.getByRole("cell", { name: "£" })).toHaveText("£30.00");
  `;
  const v = checkAssertionIntegrity(before, after);
  assert.deepEqual(v.violations, []);
});
