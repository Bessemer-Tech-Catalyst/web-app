/**
 * What the agents are told about the target, and what they are not allowed to do to it.
 *
 * `target-profile.ts` finds out what the target *is*. This turns that into two things
 * the pipeline can act on:
 *
 *   1. **A policy** — machine-checkable limits. Which hosts the crawl may touch, whether
 *      the run may mutate the application, whether an account may be created. On a
 *      bundled demo on localhost these are wide open; on somebody else's production site
 *      handed over five minutes ago they are not, and that is a correctness property
 *      before it is a courtesy one. An agent that signs up for three accounts and gets
 *      the demo machine rate-limited has lost the demo.
 *
 *   2. **A briefing** — prose spliced into every agent's prompt, saying what this
 *      particular application will do to them and what to do about it. The prompts in
 *      `recon.ts`, `planner.ts` and `generator.ts` are written for a well-behaved
 *      application. Real ones put a consent modal over the fold, render nothing until
 *      they hydrate, keep their controls on a canvas, and answer a login form with a
 *      CAPTCHA. Each of those has a correct response and none of them is guessable from
 *      the accessibility snapshot alone.
 *
 * The briefing is deliberately *instructions*, not facts. "This site uses Cookie-Script"
 * is a fact a model can do nothing with; "a consent dialog will cover the page and
 * intercept your clicks — dismiss it by declining non-essential cookies before you
 * conclude anything about this page" is a move.
 */

import type { Archetype, TargetProfile } from "./target-profile.ts";

export interface SitePolicy {
  /** Hosts the crawl and the suite may visit. Anything else is out of scope. */
  allowedHosts: string[];
  /** Whether the run may change application state at all. */
  mayMutate: boolean;
  /** Whether the run may create an account. Off for anything not ours. */
  maySignUp: boolean;
  /**
   * Whether a scenario may exercise a genuinely destructive control — delete, cancel,
   * pay. On a target we own this is where the interesting defects are; on somebody
   * else's production data it is vandalism.
   */
  mayActDestructively: boolean;
  /** Set when a bot challenge means some flows honestly cannot be automated. */
  challengeExpected: boolean;
}

/**
 * `hasCredentials` is a property of the *run*, not of the target, which is why it is a
 * separate argument. It is the whole difference between "a site we found" and "a site
 * somebody handed us keys to": credentials supplied with a URL are the owner asking for
 * the application to be exercised, and that is what re-opens mutation below.
 */
export function sitePolicy(p: TargetProfile, hasCredentials: boolean): SitePolicy {
  const ours = p.exposure === "local";
  return {
    // Subdomains of the same registrable domain are in scope — an app that keeps its
    // API on `api.` or its editor on `app.` is one application, and a crawl that cannot
    // follow it maps half a product. Anything past that boundary is somebody else's.
    allowedHosts: [p.host, `*.${p.registrableDomain}`],
    // Read-only against a third party is the wrong default in one direction and the
    // right one in the other: the pipeline's whole value is exercising flows, but a
    // production site belonging to a company that did not ask us is not the place to
    // find that out. Credentials handed over with the target are the signal that the
    // owner *did* ask: that is what the judges provide, and it re-opens mutation.
    mayMutate: ours || hasCredentials,
    maySignUp: ours,
    mayActDestructively: ours || hasCredentials,
    challengeExpected: p.botProtection.length > 0,
  };
}

/**
 * Playbooks per archetype: the handful of things that are true of a *kind* of
 * application and that an agent cannot infer from one page of accessibility tree.
 *
 * The workflow-builder entry is the longest on purpose. It is the archetype most likely
 * to be handed over at judging time, and it is the one where naive Playwright fails
 * hardest — a node editor is a canvas of absolutely-positioned elements, its work is
 * asynchronous, its most important control opens a modal over the thing you were looking
 * at, and its happy path involves dragging. Every line below is a failure this pipeline
 * would otherwise walk into.
 */
const PLAYBOOKS: Record<Archetype, string[]> = {
  "workflow-builder": [
    "This is a workflow or automation builder: a canvas of nodes wired together, plus an editor for each node. Its meaningful flows are build → configure → connect → execute → inspect result → save/activate, and a plan that only signs in and looks at a list has tested none of it.",
    "Do not drag nodes to build a graph. Drag-and-drop on a zoomable canvas is the least reliable thing Playwright does and it is almost never the only way: these editors add a node from a '+' affordance on the canvas or on a node's output handle, or from a keyboard-opened node panel, and those paths are ordinary clicks. Use them.",
    "Adding a node usually opens a searchable panel and then a node-detail view over the canvas. That detail view must be closed before the canvas is interactable again — a click that 'does nothing' is usually a click landing on the overlay you left open.",
    "Executing a workflow is asynchronous and often streamed over a websocket. Never assert on a network response and never sleep. Assert on what the interface shows when it finishes: a success or error badge on the node, an execution entry in the log or history panel, output data appearing in the node's result pane.",
    "A node's output data pane is the real assertion target. 'The workflow executed' is weak — a workflow can execute and produce nothing. 'The node shows N output items' or 'the output contains the field the node was configured to produce' is a claim that fails when the product is broken.",
    "Elements on a canvas can be scrolled or zoomed out of view while still existing in the DOM. Prefer the editor's own 'fit to view' / 'zoom to fit' control, or scroll the element into view, before asserting visibility.",
    "Name anything you create with a unique, obviously-generated name that includes the run id. These applications persist what you build, and a suite that creates 'My workflow' on every run cannot tell its own leftovers from the application's real state.",
    "Error states are the richest coverage here and they are reachable without breaking anything: a node configured with a missing required field, a credential that does not exist, an expression that references a field the input does not have. Each produces a visible, assertable error and none of them requires the backend to fail.",
  ],
  ecommerce: [
    "The meaningful flows are browse → add to basket → adjust quantity → checkout → confirm, plus what happens when each step is done wrongly: an empty basket, an out-of-stock item, an invalid payment detail, a coupon that does not apply.",
    "Basket state is often kept client-side. A test that assumes the basket survives a fresh browser context, or that it starts empty, is asserting on the harness rather than the application — establish the state the scenario needs from within the test.",
    "Do not complete a real payment. Assert up to the point where the application asks for money, and treat the payment provider's own interface as out of scope.",
  ],
  "saas-dashboard": [
    "The meaningful flows are the CRUD of whatever object the product is about, plus the permission boundaries around it: what a signed-out visitor sees at a protected route, what a member sees that an admin does not.",
    "Lists are paginated, sorted and filtered, and each of those is a flow with an observable result. They are also where empty states live — the surface most likely to be broken and least likely to be tested.",
    "Data you create persists across runs. Name it uniquely and assert on the object you created, never on 'the first row'.",
  ],
  "auth-portal": [
    "The meaningful flows are the negative ones. A correct password proves little; a rejected password, a locked account, a reset link, an expired session and a protected route visited anonymously are where the defects are.",
    "Never attempt to brute-force or enumerate accounts. One rejected attempt with an obviously invalid credential proves the error path.",
  ],
  docs: [
    "Documentation sites have few state-changing flows. Search, navigation between versions, and the code-copy affordances are the interactive surface worth testing; the rest is content.",
    "Do not plan a scenario per page. One scenario that proves navigation and search work is worth more than twenty that assert a heading exists.",
  ],
  "content-site": [
    "Most of this site is content, and asserting that content exists is close to worthless — it changes weekly and the test will be red by Friday for no reason.",
    "The interactive surface is the part worth planning: navigation, search, forms, the pricing toggle, the link into the product. Prefer those, and prefer structural assertions (a form rejects a malformed email) over textual ones (the heading says X).",
  ],
  unknown: [
    "The archetype could not be read from the landing page. Spend the first part of the crawl finding out what this application is *for* before planning anything — the shape of the plan should follow from the product, not from a checklist.",
  ],
};

/**
 * The briefing block spliced into every agent's prompt.
 *
 * `agent` shapes the closing paragraph only: Recon is being told how to crawl, the
 * Planner how to scope, the Generator how to write a locator that resolves. The facts
 * above that are identical for all three on purpose — three agents with three different
 * pictures of the same target is how a plan gets written for one application and a suite
 * for another.
 */
export function siteBriefing(
  p: TargetProfile,
  policy: SitePolicy,
  agent: "recon" | "planner" | "generator" | "healer",
): string {
  const lines: string[] = ["## What is known about this target before you start", ""];

  lines.push(
    `It answered ${p.reachable ? `HTTP ${p.status}` : "no plain HTTP request"} at ${p.origin}` +
      (p.redirectedTo ? `, redirecting to ${p.redirectedTo}` : "") +
      `. Treat all of this as a prior, not as fact: it was read from the page source, and you are the one actually looking at the application.`,
  );

  if (p.rendering === "client") {
    lines.push(
      "- **It renders on the client.** The first snapshot after any navigation will often be empty or " +
        "half-built. That is hydration, not an empty page — wait for a settled state and snapshot again " +
        "before concluding anything. Concluding a route is broken from a first snapshot is the single " +
        "most common way a run of this pipeline produces a confident, wrong answer.",
    );
  }

  if (p.consentLikely) {
    lines.push(
      (p.consentPlatform
        ? `- **A ${p.consentPlatform} consent dialog stands in front of the content.**`
        : "- **Expect a cookie or consent dialog in front of the content.** None was named in the page " +
          "source, but these are injected at runtime by a tag manager far more often than not, so its " +
          "absence from the source proves nothing.") +
        " If one appears it is modal: it will " +
        "cover the page and intercept your clicks, and a click that reports 'element intercepts pointer " +
        "events' is almost certainly this. Dismiss it before doing anything else, choosing the most " +
        "privacy-preserving option available — decline non-essential cookies, or reject all. Do not accept " +
        "all, and do not plan or generate tests *about* the consent dialog: it is a door, not a feature of " +
        "the application under test.",
    );
  }

  if (p.botProtection.length) {
    lines.push(
      `- **Bot mitigation is present (${p.botProtection.join(", ")}).** If a flow puts a CAPTCHA or a ` +
        "challenge in front of you, stop that flow there. Do not attempt to solve it, work around it or " +
        "retry it repeatedly — repeated attempts get the whole run blocked, and the next agent inherits a " +
        "blocked target. Report the flow as unreachable and say the challenge is why. An honest 'this " +
        "cannot be automated from outside' is a real result and it is reported as one.",
    );
  }

  if (p.testIdAttr) {
    lines.push(
      p.testIdAttr === "data-testid"
        ? "- **Test hooks are `data-testid`**, which is Playwright's default, so `getByTestId('x')` resolves as written."
        : `- **Test hooks are \`${p.testIdAttr}\`, not \`data-testid\`.** This is the most valuable line in this ` +
          `briefing. Playwright's \`getByTestId()\` resolves \`data-testid\` and nothing else unless it is ` +
          `configured otherwise, so \`getByTestId('thing')\` against this application matches **nothing** — ` +
          `every test using it fails to resolve, and it fails in a way that looks like the element is missing. ` +
          `Write \`page.locator('[${p.testIdAttr}="thing"]')\` instead, which is attribute-explicit and always ` +
          `correct, or prefer a role- or label-based locator where one exists.`,
    );
  }

  if (p.robotsDisallow.length) {
    lines.push(
      `- Paths \`robots.txt\` asks automated clients to leave alone: ${p.robotsDisallow.slice(0, 8).join(", ")}. Stay out of them.`,
    );
  }

  lines.push(
    "",
    "## Scope — this is a boundary, not a preference",
    "",
    `Stay on **${policy.allowedHosts.join("** and **")}**.` +
      (p.siblingHosts.length
        ? ` That includes this product's own subdomains — ${p.siblingHosts.slice(0, 5).join(", ")}${p.siblingHosts.length > 5 ? ", and others" : ""} — which are the same application and are in scope.`
        : "") +
      ` The landing page also links to ${p.externalHosts.length} ` +
      `third-party host(s)${p.externalHosts.length ? ` (${p.externalHosts.slice(0, 6).join(", ")}${p.externalHosts.length > 6 ? ", …" : ""})` : ""}. ` +
      "Those are other people's applications: they are not under test, they are not in the plan, and following " +
      "a link into one spends the run's budget mapping a site nobody asked about. If a flow leaves the target — " +
      "an OAuth provider, a payment processor, a documentation host — the flow's boundary is the moment it " +
      "leaves, and what you assert is that the application handed off correctly.",
  );

  if (!policy.mayMutate) {
    lines.push(
      "",
      "## This target is somebody else's production site",
      "",
      "No credentials were supplied and the target is not ours, so the run is **read-only**. Do not submit " +
        "forms, do not create an account, do not send a message, do not subscribe to anything, do not place " +
        "an order. Plan and generate around what can be verified without changing anything: navigation, " +
        "rendering, client-side validation that fires before submission, search, filtering, responsive " +
        "behaviour, and the fact that protected routes refuse an anonymous visitor.",
      "A scenario that would require mutating this application is not a scenario to write and quietly skip — " +
        "leave it out of the plan, and it will be carried into the risk ledger as an untested surface with " +
        "the reason attached. That is the honest reporting of a real constraint, and it is worth more than a " +
        "test that was never allowed to run.",
    );
  } else if (!policy.maySignUp) {
    lines.push(
      "",
      "## Mutation is allowed; account creation is not",
      "",
      "Credentials were supplied for this target, so exercising its flows is what you are here to do. Do not " +
        "create additional accounts, and do not change the credentials you were given — a run that changes its " +
        "own password cannot be repeated, and neither can the demo.",
    );
  }

  const playbook = PLAYBOOKS[p.archetype];
  if (playbook) {
    lines.push("", `## Working with a ${p.archetype.replace(/-/g, " ")}`, "");
    for (const item of playbook) lines.push(`- ${item}`);
  }

  lines.push("", ...closing(agent, p, policy));
  return lines.join("\n");
}

function closing(
  agent: "recon" | "planner" | "generator" | "healer",
  p: TargetProfile,
  policy: SitePolicy,
): string[] {
  switch (agent) {
    case "recon":
      return [
        "## Your job against this particular target",
        "",
        "Map it, and map the things a plan will need that a route list does not carry: which surfaces require " +
          "a session, which controls are destructive, where the empty states are, and what the application is " +
          "*for*. " +
          (p.rendering === "client"
            ? "Because this renders on the client, budget a settle-and-re-snapshot on every route rather than treating the first snapshot as the answer. "
            : "") +
          "Prefer breadth over depth: ten distinct surfaces seen once are worth more to the Planner than one " +
          "surface seen ten ways.",
        "",
        "If you find a test-hook attribute on this application's own elements, say so in your evidence and name " +
          "the attribute exactly. The Generator's locators depend on it.",
      ];
    case "planner":
      return [
        "## Your job against this particular target",
        "",
        "Plan the flows this application exists to perform, in the order a real user would meet them, and " +
          "spend most of the budget on the ones where a defect would actually hurt. " +
          (policy.mayMutate
            ? "You may plan flows that change state — that is where the defects are."
            : "You may not plan flows that change state; see the scope section above.") +
          " Ground every scenario in something Recon observed. A scenario about a surface nobody saw is a " +
          "scenario the Generator will quarantine, and it costs the same as a real one.",
      ];
    case "generator":
      return [
        "## Your job against this particular target",
        "",
        "Every locator you emit must have been resolved on the live page in this session — that is checked " +
          "mechanically afterwards and a guess is not a near miss, it is a quarantine. " +
          (p.testIdAttr && p.testIdAttr !== "data-testid"
            ? `Against this application that means: do not write \`getByTestId\`. Use \`page.locator('[${p.testIdAttr}="…"]')\`. `
            : "") +
          (p.rendering === "client"
            ? "Because this renders on the client, every assertion must be a web-first one that retries — " +
              "`await expect(locator).toBeVisible()`, never a bare read followed by a comparison. "
            : "") +
          "Walk the application to the state the scenario describes before generating anything for that state: " +
          "a control inside a dialog does not exist until the dialog is open, and a locator proven in the wrong " +
          "state is a locator that fails in the suite.",
      ];
    case "healer":
      return [
        "## Your job against this particular target",
        "",
        "Re-prove every locator you write, in the state the failing step runs in. " +
          (p.rendering === "client"
            ? "This application renders on the client, so a failure that looks like a missing element is very " +
              "often a missing wait — prefer strengthening the wait over retargeting the locator. "
            : "") +
          "You may change locators and waits. You may not change what the test proves; that is checked by a " +
          "diff of the assertion set and a patch that weakens one is rejected outright.",
      ];
  }
}
