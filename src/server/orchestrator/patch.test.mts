/**
 * The test for the heal diff.
 *
 * The diff is the artifact a person reviews a heal by, so the property that matters is
 * that it describes the patch that was actually applied: the same before/after the
 * assertion-integrity guard checked and the same text written to the spec file. A diff
 * that drops a changed line, or invents one, would let a rejected-looking heal read as
 * an accepted one.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { unifiedDiff } from "./patch.ts";

const BEFORE = `import { test, expect } from "@playwright/test";

test("adds an item to the cart", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('cart-badge')).toHaveText('1');
});
`;

const AFTER = BEFORE.replace("{ name: 'Add to cart' }", "{ name: 'Add to bag' }");

test("the changed line appears once removed and once added", () => {
  const diff = unifiedDiff(BEFORE, AFTER, "tests/cart.spec.ts");
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  assert.equal(removed.length, 1);
  assert.equal(added.length, 1);
  assert.match(removed[0], /Add to cart/);
  assert.match(added[0], /Add to bag/);
});

test("it names the file on both sides, so the artifact is applyable", () => {
  const diff = unifiedDiff(BEFORE, AFTER, "tests/cart.spec.ts");
  assert.ok(diff.startsWith("--- a/tests/cart.spec.ts\n+++ b/tests/cart.spec.ts\n"));
  assert.match(diff, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
});

test("the untouched assertion is carried as context, not as a change", () => {
  const diff = unifiedDiff(BEFORE, AFTER, "tests/cart.spec.ts");
  // One space for the unified-diff " " marker, two for the line's own indentation.
  assert.match(diff, /^ {3}await expect\(page\.getByTestId\('cart-badge'\)\)\.toHaveText\('1'\);$/m);
});

test("an added line is an addition with nothing removed", () => {
  const after = BEFORE.replace(
    '  await page.goto("/shop");',
    '  await page.goto("/shop");\n  await expect(page.getByRole(\'heading\')).toBeVisible();',
  );
  const diff = unifiedDiff(BEFORE, after, "tests/cart.spec.ts");
  assert.equal(diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length, 0);
  assert.equal(diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length, 1);
});

test("two separate edits both survive into the diff", () => {
  const after = AFTER.replace("/shop", "/store");
  const diff = unifiedDiff(BEFORE, after, "tests/cart.spec.ts");
  assert.match(diff, /-\s+await page\.goto\("\/shop"\)/);
  assert.match(diff, /\+\s+await page\.goto\("\/store"\)/);
  assert.match(diff, /Add to bag/);
});

test("an unchanged file produces no hunks rather than a misleading one", () => {
  const diff = unifiedDiff(BEFORE, BEFORE, "tests/cart.spec.ts");
  assert.match(diff, /\(no textual change\)/);
});
