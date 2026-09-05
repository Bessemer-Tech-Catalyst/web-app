/**
 * The risk prior — the numbers the report ranks untested surfaces by.
 *
 * These weights are the product's opinion and they are meant to be arguable. What they
 * must not be is *accidental*: a quiet edit to one regex silently re-ranks every report
 * the system will ever produce, and nothing about the output would look wrong. So the
 * cases below pin the ordering that matters — a credential surface the PRD names outranks
 * a deep read-only page, and a surface the plan tried to cover and could not outranks one
 * nobody thought about — rather than pinning every arithmetic total.
 *
 * The property test at the bottom is the important one: every factor that fires has to
 * produce a sentence. A score with no reasons behind it is the exact thing this module
 * exists to avoid, and it would render as a confident number with an empty list under it.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { WEIGHT, bandOf, mentionedInPrd, scoreSurface, type RiskFacts } from "./risk-signals.ts";
import type { Gap } from "@/lib/types";

const facts = (over: Partial<RiskFacts> & { surface: string }): RiskFacts => ({
  status: "untested",
  authenticated: false,
  gaps: [],
  ...over,
});

const fired = (surface: string, over: Partial<RiskFacts> = {}) =>
  scoreSurface(facts({ surface, ...over })).factors.map((f) => f.id);

test("a credential surface is recognised however it is spelled", () => {
  for (const path of ["/forgot-password", "/auth/reset", "/sign-in", "/account/security", "/mfa"]) {
    assert.ok(fired(path).includes("credentials"), `${path} should read as a credential surface`);
  }
});

test("a money or personal-data surface is recognised", () => {
  for (const path of ["/checkout", "/billing/invoice", "/orders", "/account/addresses"]) {
    assert.ok(fired(path).includes("payments-pii"), `${path} should read as payment/PII`);
  }
});

test("a destructive or privileged surface is recognised", () => {
  for (const path of ["/admin/users", "/account/delete", "/subscription/cancel"]) {
    assert.ok(fired(path).includes("destructive"), `${path} should read as destructive`);
  }
});

test("an ordinary read-only page fires none of the three content factors", () => {
  const ids = fired("/docs/getting-started/advanced");
  for (const id of ["credentials", "payments-pii", "destructive"]) {
    assert.ok(!ids.includes(id as never), `${id} should not fire on a docs page`);
  }
});

test("depth decides reachability — a deep page is not one click away", () => {
  assert.ok(fired("/orders").includes("shallow"));
  assert.ok(!fired("/a/b/c/d").includes("shallow"));
});

test("the landing page and the sign-in page are never called session-gated", () => {
  assert.ok(!fired("/", { authenticated: true }).includes("session-gated"));
  assert.ok(!fired("/login", { authenticated: true }).includes("session-gated"));
  assert.ok(fired("/orders", { authenticated: true }).includes("session-gated"));
});

test("a signed-out run gates nothing, because there was no session to be behind", () => {
  assert.ok(!fired("/orders", { authenticated: false }).includes("session-gated"));
});

// ---------------------------------------------------------------------------
// The PRD link — the fact that makes the ledger's headline line land
// ---------------------------------------------------------------------------

test("a PRD naming the path or the label counts; a short label does not", () => {
  assert.equal(mentionedInPrd("§2.4 covers /forgot-password", "/forgot-password", "forgot password"), true);
  assert.equal(mentionedInPrd("Users may reset their password", "/x/password", "password"), true);
  // Two-letter labels would match half of any document.
  assert.equal(mentionedInPrd("The id is stable", "/x/id", "id"), false);
});

test("a PRD mention is not a substring match on another word", () => {
  assert.equal(mentionedInPrd("We support passwordless login", "/x/orders", "orders"), false);
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("a credential surface the PRD names outranks a deep unrelated page", () => {
  const reset = scoreSurface(facts({ surface: "/forgot-password", prd: "See /forgot-password in §2.4" }));
  const docs = scoreSurface(facts({ surface: "/docs/guides/deep/page" }));
  assert.ok(reset.score > docs.score, `${reset.score} should beat ${docs.score}`);
  // §3.5's own worked example, pinned: credentials + shallow + prd-named must read
  // `high`. If a weight or a threshold moves, this is the sentence that stops matching
  // the product's description of its own ledger.
  assert.equal(reset.band, "high");
  assert.equal(reset.score, 52);
});

test("the same surface, with a scenario the run could not prove, tips to critical", () => {
  const prior = scoreSurface(
    facts({
      surface: "/forgot-password",
      prd: "See /forgot-password in §2.4",
      status: "planned-only",
      quarantineReason: "The reset submit control never resolved on the live page",
    }),
  );
  assert.equal(prior.band, "critical");
});

test("a surface the plan tried to cover and could not outranks the same surface untouched", () => {
  const tried = scoreSurface(
    facts({ surface: "/checkout", status: "planned-only", quarantineReason: "The pay button never resolved" }),
  );
  const untouched = scoreSurface(facts({ surface: "/checkout" }));
  assert.equal(tried.score - untouched.score, WEIGHT.quarantined);
  assert.match(tried.factors.find((f) => f.id === "quarantined")!.reason, /pay button never resolved/);
});

test("an unclosed critic gap that names the surface is carried into its score", () => {
  const gaps: Gap[] = [
    {
      id: "g1",
      title: "No test for password reset",
      dimension: "flow-completeness",
      severity: "high",
      rationale: "Recon reached /forgot-password and no scenario covers it",
    },
  ];
  assert.ok(fired("/forgot-password", { gaps }).includes("named-in-gap"));
  assert.ok(!fired("/pricing", { gaps }).includes("named-in-gap"));
});

test("the score is capped at 100 however many factors fire", () => {
  const everything = scoreSurface(
    facts({
      surface: "/account/password/delete",
      status: "planned-only",
      authenticated: true,
      prd: "the /account/password/delete endpoint",
      gaps: [
        { id: "g", title: "delete", dimension: "destructive", severity: "critical", rationale: "/account/password/delete" },
      ],
    }),
  );
  assert.equal(everything.score, 100);
  assert.equal(everything.band, "critical");
});

test("bands are ordered and exhaustive", () => {
  assert.equal(bandOf(100), "critical");
  assert.equal(bandOf(70), "critical");
  assert.equal(bandOf(69), "high");
  assert.equal(bandOf(45), "high");
  assert.equal(bandOf(44), "medium");
  assert.equal(bandOf(22), "medium");
  assert.equal(bandOf(21), "low");
  assert.equal(bandOf(0), "low");
});

test("every factor that fires carries a sentence — no number without its reason", () => {
  const paths = ["/", "/login", "/checkout", "/admin/users/delete", "/docs", "/account/security"];
  for (const surface of paths) {
    const prior = scoreSurface(
      facts({ surface, status: "planned-only", authenticated: true, prd: surface, gaps: [] }),
    );
    for (const f of prior.factors) {
      assert.ok(f.reason.trim().length > 10, `${surface}/${f.id} has no reason`);
      assert.equal(f.weight, WEIGHT[f.id]);
    }
    assert.equal(prior.score, Math.min(100, prior.factors.reduce((n, f) => n + f.weight, 0)));
  }
});
