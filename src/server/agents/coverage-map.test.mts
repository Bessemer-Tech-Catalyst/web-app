/**
 * The coverage map — what the risk ledger's denominator is made of.
 *
 * Two properties matter here and both fail silently if they break.
 *
 * **A surface is not covered because the plan mentions it.** The whole argument of the
 * risk ledger is that a quarantined scenario produced no evidence, so a route it names
 * must come back `planned-only`. Get that wrong and the report tells a team a credential
 * flow is tested when nothing ever loaded it.
 *
 * **Prefix matches must not count.** `/order` is not `/orders`, and a substring match
 * over emitted source would report a surface as exercised on the strength of a shared
 * prefix — which is the "plausible-looking table" failure this repo keeps finding.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { labelOf, mapCoverage, mentionsControl, mentionsPath, normalise } from "./coverage-map.ts";
import type { Scenario } from "@/lib/types";

const scenario = (id: string, over: Partial<Scenario> = {}): Scenario => ({
  id,
  title: id,
  flow: "Flow",
  kind: "happy-path",
  priority: "high",
  steps: [],
  expected: "",
  ...over,
});

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

test("a quoted path in emitted source counts as a visit", () => {
  assert.equal(mentionsPath(`await page.goto("/orders");`, "/orders"), true);
  assert.equal(mentionsPath("await page.goto('/orders');", "/orders"), true);
  assert.equal(mentionsPath("await page.goto(`/orders`);", "/orders"), true);
});

test("a prefix is not a match — /order must not claim /orders", () => {
  assert.equal(mentionsPath(`await page.goto("/orders");`, "/order"), false);
  assert.equal(mentionsPath(`await page.goto("/ordersomething");`, "/orders"), false);
});

test("a query string or a fragment is still a visit to the path", () => {
  assert.equal(mentionsPath(`page.goto("/orders?page=2")`, "/orders"), true);
  assert.equal(mentionsPath(`page.goto("/orders#recent")`, "/orders"), true);
  assert.equal(mentionsPath(`page.goto("/orders/42")`, "/orders"), true);
});

test("the root route matches its own literal and nothing else", () => {
  assert.equal(mentionsPath(`await page.goto("/");`, "/"), true);
  assert.equal(mentionsPath(`await page.goto("/basket");`, "/"), false);
});

test("a full URL from recon is reduced to its path before matching", () => {
  assert.equal(normalise("https://shop.test/orders?ref=nav"), "/orders");
  assert.equal(normalise("orders/"), "/orders");
  assert.equal(normalise("https://shop.test"), "/");
});

test("a control name in the emitted source counts, because a link needs no path", () => {
  assert.equal(mentionsControl(`getByRole("link", { name: "Orders" })`, "orders"), true);
  assert.equal(mentionsControl(`getByText("Your orders")`, "orders"), true);
});

test("a control name must be a whole word, not a fragment of one", () => {
  assert.equal(mentionsControl(`getByRole("link", { name: "Reorders" })`, "orders"), false);
});

test("an identifier segment yields no label, so it cannot match everything", () => {
  assert.equal(labelOf("/orders/:id"), "");
  assert.equal(labelOf("/orders/42"), "");
  assert.equal(labelOf("/account/order-history"), "order history");
});

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

test("a route a test navigated to, in a test that ran, is exercised", () => {
  const [row] = mapCoverage({
    routes: ["/orders"],
    scenarios: [scenario("orders-view")],
    sources: { "orders-view": `await page.goto("/orders");` },
    executed: ["orders-view"],
  });
  assert.equal(row.status, "exercised");
  assert.equal(row.signal, "navigation");
  assert.deepEqual(row.tests, ["orders-view"]);
});

test("a red test still counts as exercised — a failure is evidence", () => {
  const [row] = mapCoverage({
    routes: ["/orders"],
    scenarios: [scenario("orders-view")],
    sources: { "orders-view": `page.goto("/orders")` },
    executed: ["orders-view"],
  });
  assert.equal(row.status, "exercised");
});

test("a quarantined scenario leaves its route planned-only, never covered", () => {
  const [row] = mapCoverage({
    routes: ["/forgot-password"],
    scenarios: [scenario("reset", { steps: ["Open /forgot-password and request a link"] })],
    sources: {},
    // Quarantined, so nothing ran: the caller passes no executed ids for it.
    executed: [],
  });
  assert.equal(row.status, "planned-only");
  assert.deepEqual(row.scenarios, ["reset"]);
  assert.deepEqual(row.tests, []);
});

test("a route no scenario mentions is untested, with no attribution to cite", () => {
  const [row] = mapCoverage({
    routes: ["/admin/users"],
    scenarios: [scenario("signin")],
    sources: { signin: `page.goto("/login")` },
    executed: ["signin"],
  });
  assert.equal(row.status, "untested");
  assert.equal(row.signal, "none");
  assert.equal(row.basis, undefined);
});

test("scenario text alone is a weaker signal, and the basis says so", () => {
  const [row] = mapCoverage({
    routes: ["/basket"],
    scenarios: [scenario("add-item", { steps: ["Open the basket and check the total"] })],
    // The emitted code reaches the basket by clicking, and names neither the path nor
    // a control the label matches.
    sources: { "add-item": `await page.getByTestId("cart-icon").click();` },
    executed: ["add-item"],
  });
  assert.equal(row.status, "exercised");
  assert.equal(row.signal, "scenario-text");
  assert.match(row.basis ?? "", /the plan's word, not the suite's/);
});

test("duplicate routes from recon collapse to one row", () => {
  const rows = mapCoverage({
    routes: ["/orders", "/orders/", "https://shop.test/orders?x=1"],
    scenarios: [],
    sources: {},
    executed: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].surface, "/orders");
});
