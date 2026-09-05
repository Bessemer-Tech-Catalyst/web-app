/**
 * The crawl budget and the scope boundary, pinned with no browser and no model.
 *
 * These are the numbers that decide what a run of this pipeline costs against a target
 * nobody has seen before, so they are arithmetic on purpose and checked here rather than
 * trusted to a prompt. The worked example throughout is n8n.io, whose landing page links
 * 41 distinct same-origin paths and 21 third-party hosts — which is exactly the shape
 * that made a depth-based budget the wrong instrument.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { crawlBriefing, crawlBudget, deepestPath, frontierScore, inScope, routeTemplate } from "./route-scope.ts";
import { NavigationGuard } from "./navigation-guard.ts";

const RULES = { origin: "https://n8n.io", registrableDomain: "n8n.io" };

// --- templates -------------------------------------------------------------

test("ids, uuids and opaque tokens collapse into one surface", () => {
  assert.equal(routeTemplate("/products/1"), "/products/:id");
  assert.equal(routeTemplate("/products/2"), "/products/:id");
  assert.equal(
    routeTemplate("/workflow/8xKpQ2mNvR4tLwYz/executions/1183"),
    "/workflow/:token/executions/:id",
  );
  assert.equal(
    routeTemplate("/users/3f7a9c21-4b5e-4c8d-9a1f-2e6b8d4c7a90"),
    "/users/:uuid",
  );
});

/**
 * The property the whole budget rests on. A list page linking ten rows is ten URLs and
 * one surface; a crawl that does not know this spends its entire allowance on the first
 * list it meets.
 */
test("ten rows of one list are one surface, not ten", () => {
  const seen = new Set(
    // Real workflow ids, as n8n mints them.
    ["/workflow/8xKpQ2mNvR4tLwYz", "/workflow/JmW3zRt9Qa", "/workflow/b7Kd2Lp0Xn", "/workflow/Zq09McTr41"].map((p) =>
      routeTemplate(p),
    ),
  );
  assert.equal(seen.size, 1);
});

test("a view selector is a distinct surface; a tracking tag is not", () => {
  assert.equal(routeTemplate("/executions", "?tab=failed"), "/executions?tab=failed");
  assert.notEqual(routeTemplate("/executions", "?tab=failed"), routeTemplate("/executions"));
  // The same page with a campaign tag must not read as a new surface.
  assert.equal(routeTemplate("/pricing", "?utm_source=twitter&gclid=xyz"), "/pricing");
});

test("trailing slashes and casing do not create surfaces", () => {
  assert.equal(routeTemplate("/Pricing/"), routeTemplate("/pricing"));
});

// --- scope -----------------------------------------------------------------

test("subdomains of the target are in scope; other hosts are not", () => {
  assert.equal(inScope("https://docs.n8n.io/api", RULES).inScope, true);
  assert.equal(inScope("/pricing", RULES).inScope, true);
  for (const away of [
    "https://github.com/n8n-io/n8n",
    "https://x.com/n8n_io",
    "https://www.youtube.com/@n8n",
    "https://www.shopify.com",
    "https://not-n8n.io/",
  ]) {
    const v = inScope(away, RULES);
    assert.equal(v.inScope, false, away);
  }
});

/**
 * The lookalike case. `evil-n8n.io` and `n8n.io.attacker.com` both contain the target's
 * domain as a substring, and a naive `includes()` would follow both.
 */
test("a host that merely contains the domain is out of scope", () => {
  assert.equal(inScope("https://n8n.io.attacker.com/", RULES).inScope, false);
  assert.equal(inScope("https://evil-n8n.io/", RULES).inScope, false);
});

test("assets, mailto and javascript are never surfaces", () => {
  for (const href of [
    "/logo.svg",
    "/app.bundle.js",
    "/whitepaper.pdf",
    "mailto:hi@n8n.io",
    "javascript:void(0)",
  ]) {
    assert.equal(inScope(href, RULES).inScope, false, href);
  }
});

test("robots.txt disallow is honoured", () => {
  const rules = { ...RULES, robotsDisallow: ["/cdn-cgi/", "/admin*"] };
  assert.equal(inScope("https://n8n.io/cdn-cgi/trace", rules).inScope, false);
  assert.equal(inScope("https://n8n.io/admin/users", rules).inScope, false);
  assert.equal(inScope("https://n8n.io/pricing", rules).inScope, true);
});

// --- ordering --------------------------------------------------------------

/**
 * Breadth-first order is arrival order, and on a marketing site arrival order is the
 * footer. This is what puts the application ahead of the brochure.
 */
test("the application ranks above the website around it", () => {
  const app = frontierScore("/workflow/:token");
  const dashboard = frontierScore("/dashboard");
  const login = frontierScore("/signin");
  const blog = frontierScore("/blog/how-we-scaled");
  const legal = frontierScore("/legal/privacy-policy");
  const careers = frontierScore("/careers");

  for (const low of [blog, legal, careers]) {
    assert.ok(app > low, `workflow ${app} should outrank ${low}`);
    assert.ok(dashboard > low, `dashboard ${dashboard} should outrank ${low}`);
    assert.ok(login > low, `login ${login} should outrank ${low}`);
  }
});

test("scores stay inside 0–100 however deep or however loaded the path", () => {
  for (const p of ["/", "/a/b/c/d/e/f/g/h", "/legal/privacy/cookies/terms", "/workflow/dashboard/checkout"]) {
    const s = frontierScore(p);
    assert.ok(s >= 0 && s <= 100, `${p} scored ${s}`);
  }
});

// --- budget ----------------------------------------------------------------

test("the budget follows the money, not a depth slider", () => {
  const lean = crawlBudget({ discoveredPaths: 41, rendering: "server", authenticated: false, budgetUsd: 1 });
  const rich = crawlBudget({ discoveredPaths: 41, rendering: "server", authenticated: false, budgetUsd: 20 });
  assert.ok(rich.maxSurfaces > lean.maxSurfaces);
  assert.ok(lean.maxSurfaces >= 6, "even a minimal run gets a crawl worth having");
});

test("a client-rendered target costs more per surface, so it gets fewer", () => {
  const base = { discoveredPaths: 41, authenticated: false, budgetUsd: 5 };
  const server = crawlBudget({ ...base, rendering: "server" });
  const client = crawlBudget({ ...base, rendering: "client" });
  assert.ok(client.maxSurfaces < server.maxSurfaces);
});

test("a credentialed run gets more, because there are two applications to map", () => {
  const base = { discoveredPaths: 41, rendering: "server" as const, budgetUsd: 5 };
  assert.ok(
    crawlBudget({ ...base, authenticated: true }).maxSurfaces >
      crawlBudget({ ...base, authenticated: false }).maxSurfaces,
  );
});

test("a tiny site never gets a budget larger than the site", () => {
  const b = crawlBudget({ discoveredPaths: 3, rendering: "server", authenticated: false, budgetUsd: 25 });
  assert.ok(b.maxSurfaces <= 3 + 12);
});

// --- depth: back as a real, recognisable number, no longer a fixed 2 ------

test("depth defaults to 2 for an ordinary anonymous site", () => {
  const b = crawlBudget({ discoveredPaths: 41, rendering: "server", authenticated: false, budgetUsd: 5 });
  assert.equal(b.maxDepth, 2);
});

test("a workflow builder or dashboard widens depth — a real flow nests that far in", () => {
  const base = { discoveredPaths: 41, rendering: "server" as const, authenticated: false, budgetUsd: 5 };
  assert.equal(crawlBudget({ ...base, archetype: "workflow-builder" }).maxDepth, 3);
  assert.equal(crawlBudget({ ...base, archetype: "saas-dashboard" }).maxDepth, 3);
  // A blog or a docs site has no such flow, so the default holds.
  assert.equal(crawlBudget({ ...base, archetype: "content-site" }).maxDepth, 2);
  assert.equal(crawlBudget({ ...base, archetype: "unknown" }).maxDepth, 2);
});

test("a signed-in run gets one more link of depth than an anonymous one, and depth is capped", () => {
  const base = { discoveredPaths: 41, rendering: "server" as const, budgetUsd: 5, archetype: "workflow-builder" as const };
  assert.equal(crawlBudget({ ...base, authenticated: false }).maxDepth, 3);
  assert.equal(crawlBudget({ ...base, authenticated: true }).maxDepth, 4);
  // The ceiling holds even for the archetype+authenticated combination that pushes hardest.
  assert.ok(crawlBudget({ ...base, authenticated: true }).maxDepth <= 4);
});

test("deepestPath picks the most illustrative real path, not just the first one", () => {
  assert.equal(
    deepestPath(["/pricing", "/case-studies/vodafone/", "/legal/privacy/cookies"]),
    "/legal/privacy/cookies",
  );
  assert.equal(deepestPath([]), undefined);
});

test("the briefing names a real discovered path so the depth number means something", () => {
  const budget = crawlBudget({ discoveredPaths: 41, rendering: "server", authenticated: false, budgetUsd: 5 });
  const text = crawlBriefing(budget, RULES, ["/pricing", "/case-studies/vodafone/"]);
  assert.match(text, /case-studies\/vodafone/);
  assert.match(text, /2 link\(s\) in/);
});

test("the briefing still reads sensibly with no discovered paths at all", () => {
  const budget = crawlBudget({ discoveredPaths: 0, rendering: "server", authenticated: false, budgetUsd: 5 });
  const text = crawlBriefing(budget, RULES, []);
  assert.match(text, /How far to crawl/);
});

// --- the guard -------------------------------------------------------------

function guard(maxSurfaces: number, enforceBudget = true) {
  return new NavigationGuard({ ...RULES, maxSurfaces, enforceBudget });
}

test("an out-of-scope navigation is refused with a reason naming the boundary", () => {
  const g = guard(20);
  const v = g.check("https://github.com/n8n-io/n8n");
  assert.equal(v.allowed, false);
  assert.match((v as { reason: string }).reason, /github\.com is outside n8n\.io/);
  assert.equal(g.refusals.length, 1);
  assert.equal(g.surfacesUsed, 0, "a refused navigation must not spend budget");
});

test("the surface budget is spent by distinct templates and refused past the cap", () => {
  const g = guard(3);
  assert.equal(g.check("https://n8n.io/").allowed, true);
  assert.equal(g.check("https://n8n.io/pricing").allowed, true);
  assert.equal(g.check("https://n8n.io/dashboard").allowed, true);
  assert.equal(g.budgetLeft, 0);

  const refused = g.check("https://n8n.io/settings");
  assert.equal(refused.allowed, false);
  assert.match((refused as { reason: string }).reason, /budget of 3 distinct surfaces is spent/);
});

/**
 * Charging for a return trip would make the budget punish exactly the behaviour it wants:
 * an agent going back to a list page to reach the next item is crawling correctly.
 */
test("revisiting a surface already seen is always free", () => {
  const g = guard(2);
  g.check("https://n8n.io/workflows");
  g.check("https://n8n.io/workflow/8xKpQ2mNvR4tLwYz");
  assert.equal(g.budgetLeft, 0);
  // Both are templates already visited, so both are allowed with no budget left.
  assert.equal(g.check("https://n8n.io/workflows").allowed, true);
  assert.equal(g.check("https://n8n.io/workflow/JmW3zRt9Qa77").allowed, true);
  assert.equal(g.surfacesUsed, 2);
});

test("the Generator keeps the host boundary and loses the cap", () => {
  const g = guard(1, /* enforceBudget */ false);
  g.check("https://n8n.io/a");
  assert.equal(g.check("https://n8n.io/b").allowed, true, "no cap for a non-crawling agent");
  assert.equal(g.check("https://github.com/x").allowed, false, "the boundary still holds");
});

/**
 * The refusal has to read as a Playwright MCP error, because `harness.ts` decides whether
 * a tool call failed by looking for exactly this prefix. Without it the Decision Log
 * would record a refused navigation as a successful one.
 */
test("a refusal is shaped like the tool error the harness already understands", () => {
  const text = NavigationGuard.refusalText("https://github.com/x", "out of scope", 4);
  assert.match(text, /^### Error/);
  assert.match(text, /4 surface\(s\) of budget left/);

  const spent = NavigationGuard.refusalText("https://n8n.io/blog", "budget spent", 0);
  assert.match(spent, /Stop crawling and report what you have mapped/);
});
