/**
 * The test for the locator-provenance gate — the rule that a locator never resolved on
 * the live page does not ship.
 *
 * The ledger entries below are Playwright MCP replies copied verbatim from a live
 * `@playwright/mcp@0.0.80` session, in both shapes the server actually emits: the
 * `### Ran Playwright code` block that comes back from any call touching an element, and
 * the bare `### Result` expression from `browser_generate_locator`.
 *
 * The gate is a safety property, so the tests that matter most are the `rejects` ones. If
 * a change here makes a previously-rejected locator pass, that change is wrong: widen
 * `REFINEMENTS` for a genuinely narrowing operation, but never weaken the comparison to
 * make a run look better.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { harvest, prove } from "./locator-provenance.ts";

/** A ledger built from real MCP replies, shared by most of the cases below. */
function liveLedger(): Set<string> {
  const ledger = new Set<string>();
  harvest(ledger, "### Result\ngetByRole('button', { name: 'New appointment' })");
  harvest(
    ledger,
    "### Ran Playwright code\n```js\nawait page.getByRole('textbox', { name: 'Email' }).fill('a@b.com');\n```",
  );
  harvest(
    ledger,
    "### Ran Playwright code\n```js\nawait page.goto('http://127.0.0.1:57232/');\n```\n### Page\n- Page URL: http://127.0.0.1:57232/",
  );
  harvest(
    ledger,
    "### Result\nDone\n### Ran Playwright code\n```js\nawait expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\n```",
  );
  harvest(ledger, '### Error\nElement with role "button" and accessible name "Nope" not found');
  harvest(
    ledger,
    "### Ran Playwright code\n```js\nawait page.getByRole('list').getByRole('listitem').first().click();\n```",
  );
  return ledger;
}

const ledger = liveLedger();

function accepts(code: string, l: Set<string> = ledger) {
  const p = prove(code, l);
  assert.deepEqual(p.unproven, [], `expected no unproven locators, got ${JSON.stringify(p)}`);
  assert.ok(p.total > 0, `nothing was extracted from: ${code}`);
}

function rejects(code: string, l: Set<string> = ledger) {
  const p = prove(code, l);
  assert.ok(p.unproven.length > 0, `expected an unproven locator, got ${JSON.stringify(p)}`);
}

test("a locator the page handed back is proven, whatever the model's quoting", () => {
  accepts(`await page.getByRole('button', { name: 'New appointment' }).click();`);
  accepts(`await page.getByRole("button", {name: "New appointment"}).click();`);
});

test("the ledger is built from both MCP reply shapes", () => {
  // `### Ran Playwright code`, including one that only ever appeared inside an expect().
  accepts(`await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();`);
  accepts(`await page.getByRole('heading', { name: 'Dashboard' }).waitFor();`);
});

test("narrowing a proven locator is allowed", () => {
  // These can only ever select a subset of an element set that provably existed.
  accepts(`await page.getByRole('list').first().click();`);
  accepts(`await page.getByRole('list').nth(2).click();`);
  accepts(`await page.getByRole('list').filter({ hasText: 'x' }).click();`);
});

test("a descendant of a proven locator is not itself proven", () => {
  // `.getByRole()` into a proven element reaches a *different* element, which needs its
  // own proof. This is the line between narrowing and navigating.
  rejects(`await page.getByRole('list').getByRole('button').click();`);
});

test("an invented locator is rejected — the point of the gate", () => {
  rejects(`await page.getByRole('button', { name: 'Delete forever' }).click();`);
  rejects(`await page.getByTestId('submit').click();`);
});

test("a near-miss on the accessible name is rejected", () => {
  // 'New Appointment' is not 'New appointment'. A model that half-remembers the name is
  // guessing, and the guess is what the gate exists to catch.
  rejects(`await page.getByRole('button', { name: 'New Appointment' }).click();`);
});

test("a failed MCP call proves nothing", () => {
  // The `### Error` reply in the ledger above names a button that was never found.
  rejects(`await page.getByRole('button', { name: 'Nope' }).click();`);
});

test("non-locator page APIs are not counted as locators", () => {
  // `page.goto` is in the ledger's harvested code. If these counted, the denominator
  // would drift and `selectorsVerified/selectorsTotal` would stop meaning anything.
  assert.equal(prove(`await page.goto('/x'); await page.waitForURL('**/y');`, ledger).total, 0);
});

test("a partially-proven file reports both numbers", () => {
  const p = prove(
    `await page.getByRole('button', { name: 'New appointment' }).click();
     await page.getByLabel('Nope').fill('x');`,
    ledger,
  );
  assert.deepEqual({ total: p.total, verified: p.verified }, { total: 2, verified: 1 });
  assert.equal(p.unproven.length, 1);
});

test("counting is per distinct locator as written, not per use", () => {
  // Used twice, written the same way: one locator.
  const same = prove(
    `await page.getByRole('button', { name: 'New appointment' }).click();
     await page.getByRole('button', { name: 'New appointment' }).click();`,
    ledger,
  );
  assert.deepEqual({ total: same.total, verified: same.verified }, { total: 1, verified: 1 });

  // The same locator written two ways counts twice. `prove` dedupes on the text as the
  // model wrote it, while proving against the canonical form — so quoting can inflate
  // `selectorsTotal`, but it can never turn an unproven locator into a proven one. Only
  // the reported denominator is affected, which is why this is pinned rather than fixed.
  const requoted = prove(
    `await page.getByRole('button', { name: 'New appointment' }).click();
     await page.getByRole("button", { name: "New appointment" }).click();`,
    ledger,
  );
  assert.deepEqual({ total: requoted.total, verified: requoted.verified }, { total: 2, verified: 2 });
});

test("parens and quotes inside an accessible name do not break the scanner", () => {
  // Naive brace- or quote-matching fails on both of these, and it fails *open* — the
  // locator is not extracted at all, so it is never checked.
  const tricky = new Set<string>();
  harvest(tricky, `### Result\ngetByRole('button', { name: 'Save (draft)' })`);
  harvest(tricky, `### Result\ngetByText('It\\'s here')`);

  accepts(`await page.getByRole('button', { name: 'Save (draft)' }).click();`, tricky);
  accepts(`await page.getByText("It's here").click();`, tricky);
});

test("an empty ledger proves nothing", () => {
  const empty = new Set<string>();
  rejects(`await page.getByRole('button', { name: 'New appointment' }).click();`, empty);
});
