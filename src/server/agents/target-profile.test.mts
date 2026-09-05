/**
 * The preflight's analysis, pinned against markup shaped like the targets it will meet.
 *
 * No network: every case here is a string, because the point is the analysis rather than
 * the fetch. The fixtures are deliberately drawn from what was actually observed on
 * https://n8n.io — a Cookie-Script consent gate, Cloudflare in front, reCAPTCHA and
 * Turnstile named in the CSP, 21 third-party hosts in the footer — and from n8n's own
 * editor markup, which is where the test-id trap lives.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  analyse,
  detectArchetype,
  detectRendering,
  detectTestIdAttr,
  exposureOf,
  linkScope,
  parseRobots,
  registrableDomain,
} from "./target-profile.ts";
import { sitePolicy, siteBriefing } from "./site-policy.ts";

// --- the test-id trap ------------------------------------------------------

/**
 * The single highest-value thing this module does.
 *
 * Playwright's `getByTestId()` resolves `data-testid` and nothing else unless
 * `testIdAttribute` is configured. n8n instruments its entire workflow canvas with
 * `data-test-id` — its own Playwright config sets `testIdAttribute: 'data-test-id'` —
 * so a Generator writing the idiomatic `getByTestId('canvas-node')` produces a locator
 * matching zero elements. Every test then fails looking exactly like a missing element,
 * every scenario quarantines, and the run publishes an empty report having spent its
 * whole budget.
 */
test("n8n's data-test-id convention is detected, not mistaken for data-testid", () => {
  const canvas = `
    <div data-test-id="canvas-wrapper">
      <div data-test-id="canvas-node" data-test-id="canvas-node-status-success"></div>
      <button data-test-id="execute-workflow-button">Execute workflow</button>
      <div data-test-id="node-creator-item"></div>
      <div data-test-id="ndv-close-button"></div>
    </div>`;
  const found = detectTestIdAttr(canvas);
  assert.equal(found?.attr, "data-test-id");
});

test("the dominant convention wins over a stray vendor attribute", () => {
  // One vendor widget brings `data-test`; the application's own markup is `data-cy`.
  const html = `
    <div data-test="vendor-widget"></div>
    <a data-cy="nav-home"></a><a data-cy="nav-projects"></a>
    <button data-cy="save"></button><button data-cy="cancel"></button>`;
  assert.equal(detectTestIdAttr(html)?.attr, "data-cy");
});

/**
 * `data-test` is a prefix of both `data-test-id` and `data-testid`, so a naive count
 * gives it a majority it did not earn and configures the suite with the wrong attribute.
 */
test("data-test does not steal the count from data-test-id", () => {
  const html = `<i data-test-id="a"></i><i data-test-id="b"></i><i data-test-id="c"></i>`;
  const found = detectTestIdAttr(html);
  assert.equal(found?.attr, "data-test-id");
  assert.equal(found?.count, 3);
});

test("an application with no test hooks reports none rather than guessing", () => {
  assert.equal(detectTestIdAttr(`<div class="card"><button>Buy</button></div>`), undefined);
});

// --- scope -----------------------------------------------------------------

test("registrable domains, including the hosting suffixes a demo target lives on", () => {
  assert.equal(registrableDomain("n8n.io"), "n8n.io");
  assert.equal(registrableDomain("docs.n8n.io"), "n8n.io");
  assert.equal(registrableDomain("app.n8n.cloud"), "n8n.cloud");
  assert.equal(registrableDomain("my-app.vercel.app"), "my-app.vercel.app");
  assert.equal(registrableDomain("demo.my-app.vercel.app"), "my-app.vercel.app");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
});

test("localhost and private ranges are ours; everything else is not", () => {
  for (const h of ["localhost:3000", "127.0.0.1:8080", "192.168.1.14", "10.0.0.2", "app.local"]) {
    assert.equal(exposureOf(h), "local", h);
  }
  for (const h of ["n8n.io", "app.n8n.cloud", "example.com"]) {
    assert.equal(exposureOf(h), "public", h);
  }
});

/**
 * The three-way split, and the bug it fixes. With a two-way one, `docs.n8n.io` was
 * reported as third-party while the policy built from the same profile declared
 * `*.n8n.io` in scope — so the briefing told the agent to stay on `*.n8n.io` and then
 * listed three `n8n.io` subdomains as other people's applications.
 */
test("our paths, our subdomains, and other people's hosts are three different things", () => {
  const html = `
    <a href="/pricing">Pricing</a>
    <a href="/pricing">Pricing again</a>
    <a href="https://n8n.io/enterprise">Enterprise</a>
    <a href="https://docs.n8n.io/api">Docs</a>
    <a href="https://blog.n8n.io/post">Blog</a>
    <a href="https://github.com/n8n-io/n8n">GitHub</a>
    <a href="https://x.com/n8n_io">X</a>
    <a href="mailto:hi@n8n.io">Mail</a>
    <a href="#top">Top</a>`;
  const { paths, siblingHosts, externalHosts } = linkScope(html, "https://n8n.io", "n8n.io");
  assert.deepEqual(paths, ["/enterprise", "/pricing"]);
  assert.deepEqual(siblingHosts, ["blog.n8n.io", "docs.n8n.io"]);
  assert.deepEqual(externalHosts, ["github.com", "x.com"]);
});

/**
 * Observed live on n8n.io: a Cookie-Script modal covers the page in a real browser and
 * the server-rendered shell names it nowhere, because a tag manager injects it. Briefing
 * only on what the shell reveals would have left every click in the run landing on an
 * overlay and reporting "element intercepts pointer events" — which reads like a broken
 * application rather than an unclosed door.
 */
test("a public target is briefed for a consent gate even when the shell names none", () => {
  const p = analyse({ url: "https://n8n.io/", status: 200, html: "<html><body>Workflow automation</body></html>" });
  assert.equal(p.consentPlatform, undefined);
  assert.equal(p.consentLikely, true);
  assert.match(siteBriefing(p, sitePolicy(p, false), "recon"), /Expect a cookie or consent dialog/);
});

test("a local target is not briefed for a consent gate it will not have", () => {
  const p = analyse({ url: "http://localhost:3000/", status: 200, html: "<html><body>ShopLite</body></html>" });
  assert.equal(p.consentLikely, false);
});

// --- shell shape -----------------------------------------------------------

test("an app shell is client-rendered; a page with its content is not", () => {
  const shell = `<html><body><div id="app"></div><script>${"x".repeat(50_000)}</script></body></html>`;
  assert.equal(detectRendering(shell), "client");

  const rendered = `<html><body><h1>Pricing</h1><p>${"Real sentences of visible copy. ".repeat(200)}</p></body></html>`;
  assert.equal(detectRendering(rendered), "server");
});

test("consent platforms and bot mitigation are recognised from the shell", () => {
  const p = analyse({
    url: "https://n8n.io/",
    status: 200,
    headers: {
      server: "cloudflare",
      "content-security-policy":
        "frame-src https://www.recaptcha.net https://challenges.cloudflare.com",
    },
    html: `<script src="//cdn.cookie-script.com/s/abc.js"></script><a href="/pricing">Pricing</a>`,
  });
  assert.equal(p.consentPlatform, "Cookie-Script");
  assert.ok(p.botProtection.includes("Cloudflare Turnstile"));
  assert.ok(p.botProtection.includes("reCAPTCHA"));
});

test("archetypes are read from the words on the page", () => {
  assert.equal(
    detectArchetype("Build a workflow. Add a trigger node. Automation for every team."),
    "workflow-builder",
  );
  assert.equal(detectArchetype("Add to cart, then checkout. Your order awaits."), "ecommerce");
  // Two weak signals are not a classification.
  assert.equal(detectArchetype("Hello."), "unknown");
});

test("robots.txt is read only for the wildcard agent", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /cdn-cgi/",
    "",
    "User-agent: BadBot",
    "Disallow: /everything",
    "",
    "Sitemap: https://n8n.io/sitemap_index.xml",
  ].join("\n");
  assert.deepEqual(parseRobots(robots), ["/cdn-cgi/"]);
});

// --- policy ----------------------------------------------------------------

const publicProfile = analyse({
  url: "https://n8n.io/",
  status: 200,
  html: `<a href="/pricing">Pricing</a><a href="https://github.com/x">GitHub</a><a href="/login">Sign in</a>`,
});

/**
 * The safety property. A production site nobody handed us keys to is not the place to
 * submit forms, and it is not merely a courtesy: an agent that signs up three times and
 * trips a rate limiter has taken the target away from the demo that follows it.
 */
test("a public target with no credentials is read-only and may never sign up", () => {
  const policy = sitePolicy(publicProfile, /* hasCredentials */ false);
  assert.equal(policy.mayMutate, false);
  assert.equal(policy.maySignUp, false);
  assert.equal(policy.mayActDestructively, false);
});

test("credentials supplied with the target re-open mutation, but never sign-up", () => {
  const policy = sitePolicy(publicProfile, /* hasCredentials */ true);
  assert.equal(policy.mayMutate, true, "keys handed over are the owner asking us to exercise it");
  assert.equal(policy.maySignUp, false, "creating extra accounts is never in scope");
});

test("a local target is ours to drive completely", () => {
  const local = analyse({ url: "http://localhost:3000/shoplite", status: 200, html: "<a href='/x'>x</a>" });
  const policy = sitePolicy(local, false);
  assert.equal(policy.mayMutate, true);
  assert.equal(policy.maySignUp, true);
  assert.equal(policy.mayActDestructively, true);
});

test("the scope boundary is the registrable domain, not the exact host", () => {
  const policy = sitePolicy(publicProfile, false);
  assert.deepEqual(policy.allowedHosts, ["n8n.io", "*.n8n.io"]);
});

// --- the briefing ----------------------------------------------------------

test("the briefing tells the Generator the thing that would otherwise break every test", () => {
  const p = analyse({
    url: "https://app.n8n.cloud/",
    status: 200,
    html: `<div data-test-id="canvas-node"></div><div data-test-id="canvas-wrapper"></div>`,
  });
  const text = siteBriefing(p, sitePolicy(p, true), "generator");
  assert.match(text, /data-test-id/);
  assert.match(text, /getByTestId/, "it must name the API that silently fails");
  assert.match(text, /page\.locator\('\[data-test-id="/, "and give the locator that works");
});

test("a consent gate is briefed as a door to close, not a feature to test", () => {
  const p = analyse({
    url: "https://n8n.io/",
    status: 200,
    html: `<script src="//cdn.cookie-script.com/s/a.js"></script>`,
  });
  const text = siteBriefing(p, sitePolicy(p, false), "recon");
  assert.match(text, /intercept your clicks/);
  assert.match(text, /decline non-essential|reject all/i, "privacy-preserving by default");
  assert.match(text, /not a feature of\s+the application under test/);
});

/**
 * The honest-failure property. A CAPTCHA is a surface that genuinely cannot be automated
 * from outside, and the correct output is to say so — not to try, and not to keep trying,
 * which gets the whole run blocked and leaves the next agent a dead target.
 */
test("a bot challenge is briefed as unreachable, never as something to defeat", () => {
  const p = analyse({
    url: "https://n8n.io/",
    status: 200,
    headers: { "content-security-policy": "frame-src https://challenges.cloudflare.com" },
    html: "<html></html>",
  });
  const text = siteBriefing(p, sitePolicy(p, false), "planner");
  assert.match(text, /Do not attempt to solve it/);
  assert.match(text, /Report the flow as unreachable/);
});

test("the workflow-builder playbook reaches the planner for a canvas app", () => {
  const p = analyse({
    url: "https://app.n8n.cloud/",
    status: 200,
    html: "<p>Build a workflow with a trigger node on the canvas. Automation and pipeline tools.</p>",
  });
  assert.equal(p.archetype, "workflow-builder");
  const text = siteBriefing(p, sitePolicy(p, true), "planner");
  assert.match(text, /Do not drag nodes/, "drag-and-drop on a canvas is the classic failure");
  assert.match(text, /execute → inspect result/);
  assert.match(text, /never assert on a network response|Never assert on a network response/);
});

test("a read-only run says so, and says what to do instead", () => {
  const text = siteBriefing(publicProfile, sitePolicy(publicProfile, false), "planner");
  assert.match(text, /read-only/);
  assert.match(text, /do not create an account/i);
  assert.match(text, /carried into the risk ledger/);
});

test("every briefing names the boundary and the third-party hosts beyond it", () => {
  const text = siteBriefing(publicProfile, sitePolicy(publicProfile, false), "recon");
  assert.match(text, /github\.com/);
  assert.match(text, /Stay on/);
});
