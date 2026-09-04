/**
 * A scripted, realistic Odyssey run.
 *
 * Phase 1 uses this to drive the entire UI so the interface can be designed, demoed
 * and reviewed before any agent code exists. It emits the exact `OrchestratorEvent`
 * union the real orchestrator will emit — so Phase 2 replaces this module and nothing
 * else changes.
 *
 * The script deliberately exercises every interesting branch:
 *   - a critique that REJECTS its own plan (61) and re-plans to 88
 *   - two scenarios quarantined because their selectors could not be proven
 *   - one failure healed, one filed as a genuine app defect, one flake retried
 *   - one heal patch REJECTED by the assertion-integrity guard, then escalated
 */

import {
  type AgentName,
  type Critique,
  type Evidence,
  type FiledBug,
  type GeneratedTest,
  type HealAttempt,
  type OrchestratorEvent,
  type OrchestratorEventInit,
  type PrdRequirement,
  type RiskItem,
  type RunInput,
  type Scenario,
  type TestResult,
  type TestQualityReport,
  type TriageOutcome,
} from "./types";

export interface TimedEvent {
  delayMs: number;
  event: OrchestratorEvent;
}

// --- plan v1: thin, happy-path heavy — on purpose -----------------------------

const PLAN_V1: Scenario[] = [
  {
    id: "s1",
    title: "Sign in with valid credentials",
    flow: "Authentication",
    kind: "happy-path",
    priority: "critical",
    steps: [
      "Navigate to /login",
      "Fill email and password with valid credentials",
      "Submit the form",
    ],
    expected: "Redirected to /dashboard and the account menu shows the user's name",
  },
  {
    id: "s2",
    title: "Browse catalogue and open a product",
    flow: "Catalogue",
    kind: "happy-path",
    priority: "high",
    steps: ["Open /products", "Click the first product card"],
    expected: "Product detail page renders title, price and an Add to cart button",
  },
  {
    id: "s3",
    title: "Add an item to the cart",
    flow: "Cart",
    kind: "happy-path",
    priority: "critical",
    steps: ["Open a product", "Click Add to cart"],
    expected: "Cart badge increments to 1 and a confirmation toast appears",
  },
  {
    id: "s4",
    title: "Complete checkout with a saved card",
    flow: "Checkout",
    kind: "happy-path",
    priority: "critical",
    steps: [
      "Open the cart",
      "Continue to checkout",
      "Select the saved Visa ending 4242",
      "Place the order",
    ],
    expected: "Order confirmation page shows an order number",
  },
  {
    id: "s5",
    title: "Search for a product by name",
    flow: "Search",
    kind: "happy-path",
    priority: "medium",
    steps: ["Type a known product name in the search field", "Press Enter"],
    expected: "Results list contains the matching product",
  },
];

// --- critique v1: rejects the plan -------------------------------------------

const CRITIQUE_V1: Critique = {
  attempt: 1,
  score: 61,
  dimensions: {
    "flow-completeness": 78,
    "negative-paths": 20,
    "error-states": 25,
    "edge-cases": 35,
    "state-variants": 40,
    destructive: 30,
  },
  verdict: "replan",
  rationale:
    "The plan covers the primary surfaces but is almost entirely happy-path. Recon found a " +
    "password-reset route, a quantity stepper, an empty-cart state and a role-gated /admin " +
    "area, none of which appear. A suite of five green happy paths would give this team " +
    "false confidence. Re-planning with targeted directives.",
  gaps: [
    {
      id: "g1",
      title: "No invalid-credential path",
      dimension: "negative-paths",
      severity: "critical",
      rationale:
        "Login is tested only with valid input. The failure path is where auth regressions actually surface.",
    },
    {
      id: "g2",
      title: "Empty-cart checkout is unguarded",
      dimension: "error-states",
      severity: "high",
      rationale:
        "Recon reached /checkout with an empty cart. Nothing asserts what the app does there.",
    },
    {
      id: "g3",
      title: "Cart quantity boundaries untested",
      dimension: "edge-cases",
      severity: "high",
      rationale:
        "The stepper accepts free-typed values. 0, negative and above-stock quantities are unverified.",
    },
    {
      id: "g4",
      title: "No logged-out variant",
      dimension: "state-variants",
      severity: "high",
      rationale:
        "Every scenario assumes an authenticated session. Anonymous access to /dashboard and /checkout is unchecked.",
    },
    {
      id: "g5",
      title: "Role-gated /admin never exercised",
      dimension: "state-variants",
      severity: "critical",
      rationale:
        "Recon found /admin returning 200 for a shopper session. That is either a bug or an untested permission boundary.",
    },
    {
      id: "g6",
      title: "Item removal is destructive and untested",
      dimension: "destructive",
      severity: "medium",
      rationale: "Remove-from-cart mutates state with no coverage and no undo path.",
    },
    {
      id: "g7",
      title: "Search has no zero-result case",
      dimension: "error-states",
      severity: "medium",
      rationale: "Only a matching query is planned; the empty state is unverified.",
    },
  ],
};

// --- plan v2: the critique's directives, applied ------------------------------

const NEW_IN_V2: Scenario[] = [
  {
    id: "s6",
    title: "Reject sign-in with an invalid password",
    flow: "Authentication",
    kind: "negative",
    priority: "critical",
    steps: [
      "Navigate to /login",
      "Enter a valid email with an incorrect password",
      "Submit",
    ],
    expected:
      "Stays on /login, shows an inline error, and does not set a session cookie",
    addedByCritique: true,
  },
  {
    id: "s7",
    title: "Block anonymous access to the dashboard",
    flow: "Authorisation",
    kind: "permission",
    priority: "critical",
    steps: ["Clear session state", "Navigate directly to /dashboard"],
    expected: "Redirected to /login with a returnTo parameter",
    addedByCritique: true,
  },
  {
    id: "s8",
    title: "Shopper role cannot reach the admin console",
    flow: "Authorisation",
    kind: "permission",
    priority: "critical",
    steps: ["Sign in as a standard shopper", "Navigate directly to /admin"],
    expected: "Receives 403 or is redirected — admin controls must not render",
    addedByCritique: true,
  },
  {
    id: "s9",
    title: "Guard checkout when the cart is empty",
    flow: "Checkout",
    kind: "error-state",
    priority: "high",
    steps: ["Ensure the cart is empty", "Navigate to /checkout"],
    expected: "Empty-cart message shown and the Place order control is disabled",
    addedByCritique: true,
  },
  {
    id: "s10",
    title: "Reject a cart quantity of zero",
    flow: "Cart",
    kind: "edge-case",
    priority: "high",
    steps: ["Add an item", "Type 0 into the quantity field", "Blur the field"],
    expected: "Quantity clamps to 1 or the item is removed — never a zero-quantity line",
    addedByCritique: true,
  },
  {
    id: "s11",
    title: "Reject a quantity above available stock",
    flow: "Cart",
    kind: "edge-case",
    priority: "medium",
    steps: ["Add an item with stock 12", "Set quantity to 999"],
    expected: "Clamped to available stock with an explanatory message",
    addedByCritique: true,
  },
  {
    id: "s12",
    title: "Remove the last item from the cart",
    flow: "Cart",
    kind: "destructive",
    priority: "medium",
    steps: ["Add one item", "Open the cart", "Remove the item"],
    expected: "Cart returns to its empty state and the badge clears",
    addedByCritique: true,
  },
  {
    id: "s13",
    title: "Search with no matching results",
    flow: "Search",
    kind: "error-state",
    priority: "medium",
    steps: ["Search for a nonsense string"],
    expected: "Zero-result empty state rendered, no console errors",
    addedByCritique: true,
  },
  {
    id: "s14",
    title: "Decline an expired payment card at checkout",
    flow: "Checkout",
    kind: "negative",
    priority: "high",
    steps: ["Checkout with an item", "Select the expired test card", "Place the order"],
    expected: "Decline message shown, order not created, cart preserved",
    addedByCritique: true,
  },
  {
    id: "s15",
    title: "Request a password reset for an unknown email",
    flow: "Authentication",
    kind: "negative",
    priority: "medium",
    steps: ["Open /forgot-password", "Submit an unregistered address"],
    expected:
      "Generic confirmation shown — the response must not reveal whether the account exists",
    addedByCritique: true,
  },
];

const PLAN_V2: Scenario[] = [...PLAN_V1, ...NEW_IN_V2];

const CRITIQUE_V2: Critique = {
  attempt: 2,
  score: 88,
  previousScore: 61,
  dimensions: {
    "flow-completeness": 92,
    "negative-paths": 88,
    "error-states": 90,
    "edge-cases": 84,
    "state-variants": 91,
    destructive: 80,
  },
  verdict: "pass",
  rationale:
    "All seven gaps addressed. Coverage now spans negative paths, permission boundaries, " +
    "error states and destructive actions. Two residual gaps are accepted as out of budget " +
    "rather than unnoticed: concurrent-session behaviour and payment-provider timeout handling.",
  gaps: [
    {
      id: "g8",
      title: "Concurrent-session behaviour not covered",
      dimension: "state-variants",
      severity: "low",
      rationale: "Requires two browser contexts; deferred against the scenario budget.",
    },
    {
      id: "g9",
      title: "Payment-provider timeout not simulated",
      dimension: "error-states",
      severity: "medium",
      rationale: "Needs network interception; deferred to a follow-up run.",
    },
  ],
};

// --- generation ---------------------------------------------------------------

const GENERATED: GeneratedTest[] = [
  ["s1", "auth/sign-in-valid.spec.ts", 6, 6],
  ["s2", "catalogue/browse-product.spec.ts", 5, 5],
  ["s3", "cart/add-item.spec.ts", 5, 5],
  ["s4", "checkout/saved-card.spec.ts", 9, 9],
  ["s5", "search/find-product.spec.ts", 4, 4],
  ["s6", "auth/sign-in-invalid.spec.ts", 5, 5],
  ["s7", "authz/anonymous-dashboard.spec.ts", 3, 3],
  ["s8", "authz/shopper-cannot-admin.spec.ts", 4, 4],
  ["s9", "checkout/empty-cart-guard.spec.ts", 4, 4],
  ["s10", "cart/quantity-zero.spec.ts", 6, 6],
  ["s12", "cart/remove-last-item.spec.ts", 5, 5],
  ["s13", "search/no-results.spec.ts", 4, 4],
].map(([scenarioId, file, verified, total]) => {
  const scenario = PLAN_V2.find((s) => s.id === scenarioId)!;
  return {
    id: `t-${scenarioId}`,
    scenarioId: scenarioId as string,
    title: scenario.title,
    file: `tests/${file}`,
    selectorsVerified: verified as number,
    selectorsTotal: total as number,
  };
});

const QUARANTINED = [
  {
    scenarioId: "s11",
    title: "Reject a quantity above available stock",
    reason:
      "Stock level is not exposed anywhere in the DOM or the accessibility tree, so the " +
      "boundary cannot be asserted deterministically. Emitting a guessed threshold would " +
      "produce a test that passes for the wrong reason.",
  },
  {
    scenarioId: "s14",
    title: "Decline an expired payment card at checkout",
    reason:
      "The payment form is inside a cross-origin iframe with no test card selector available. " +
      "Requires a provider sandbox key that was not supplied.",
  },
  {
    scenarioId: "s15",
    title: "Request a password reset for an unknown email",
    reason:
      "Submitting the form triggers a real outbound email. Held back pending an explicit " +
      "opt-in for side-effecting scenarios.",
  },
];

// --- execution ----------------------------------------------------------------

interface ResultSpec {
  testId: string;
  status: TestResult["status"];
  durationMs: number;
  error?: string;
}

const RESULTS_PASS_1: ResultSpec[] = [
  { testId: "t-s1", status: "passed", durationMs: 2140 },
  { testId: "t-s2", status: "passed", durationMs: 1780 },
  { testId: "t-s5", status: "passed", durationMs: 1420 },
  { testId: "t-s6", status: "passed", durationMs: 1960 },
  { testId: "t-s7", status: "passed", durationMs: 1180 },
  { testId: "t-s9", status: "passed", durationMs: 1640 },
  { testId: "t-s13", status: "passed", durationMs: 1310 },
  { testId: "t-s12", status: "passed", durationMs: 2380 },
  {
    testId: "t-s3",
    status: "failed",
    durationMs: 30_120,
    error:
      'locator.click: Timeout 30000ms exceeded.\n  waiting for getByRole(\'button\', { name: \'Add to cart\' })\n  ↳ 0 elements match',
  },
  {
    testId: "t-s4",
    status: "failed",
    durationMs: 8940,
    error:
      "expect(received).toHaveText(expected)\n  Expected: /Order #\\d+/\n  Received: \"Something went wrong\"\n  ↳ POST /api/orders → 500",
  },
  {
    testId: "t-s8",
    status: "failed",
    durationMs: 3220,
    error:
      'expect(page).toHaveURL(expected)\n  Expected: /\\/(login|403)/\n  Received: "https://shoplite.demo/admin"\n  ↳ admin controls rendered for role=shopper',
  },
  {
    testId: "t-s10",
    status: "failed",
    durationMs: 15_400,
    error: "page.goto: net::ERR_CONNECTION_RESET at https://shoplite.demo/cart",
  },
];

// --- triage -------------------------------------------------------------------

const TRIAGE: TriageOutcome[] = [
  {
    testId: "t-s3",
    verdict: "SCRIPT_DRIFT",
    confidence: 0.94,
    rationale:
      'The accessibility snapshot still contains an equivalent control, but its accessible name ' +
      'changed from "Add to cart" to "Add to bag". The page is otherwise healthy — no console ' +
      "errors, no failed requests, and the product detail rendered fully. This is a copy change " +
      "in the app, not a defect.",
    evidence: [
      {
        kind: "snapshot-diff",
        summary: 'button "Add to cart" → button "Add to bag" at the same DOM position',
        detail:
          '- button "Add to cart" [ref=e42]\n+ button "Add to bag"  [ref=e42]',
      },
      {
        kind: "selector-provenance",
        summary: "This locator resolved successfully during generation 6m ago",
      },
      {
        kind: "console-error",
        summary: "No console errors captured on the page",
      },
      {
        kind: "network",
        summary: "All 14 requests returned 2xx",
      },
    ],
  },
  {
    testId: "t-s4",
    verdict: "APP_DEFECT",
    confidence: 0.97,
    rationale:
      "POST /api/orders returned 500 with an unhandled TypeError in the server trace. Every " +
      "locator resolved and the UI reached the correct state — the failure is downstream of the " +
      "test. Healing this would suppress a real production-severity bug, so the healer is not " +
      "invoked and the test stays red.",
    evidence: [
      {
        kind: "http-status",
        summary: "POST /api/orders → 500 Internal Server Error",
      },
      {
        kind: "console-error",
        summary:
          "Uncaught TypeError: Cannot read properties of null (reading 'last4')",
        detail: "at resolvePaymentMethod (checkout.ts:214)",
      },
      {
        kind: "selector-provenance",
        summary: "All 9 locators resolved — the script reached the final step correctly",
      },
      {
        kind: "screenshot",
        summary: "results/screenshots/t-s4-failure.png",
      },
    ],
  },
  {
    testId: "t-s8",
    verdict: "APP_DEFECT",
    confidence: 0.91,
    rationale:
      "A shopper-role session loaded /admin with a 200 and the admin controls rendered. The " +
      "assertion is correct and the app is wrong. This is a broken authorisation boundary and is " +
      "being filed at critical severity — it was the exact gap the critic added in the re-plan.",
    evidence: [
      { kind: "http-status", summary: "GET /admin → 200 for role=shopper" },
      {
        kind: "snapshot-diff",
        summary: 'heading "Admin console" and 6 admin controls present in the snapshot',
      },
      {
        kind: "prd",
        summary: "PRD §4.2: 'Admin routes must be inaccessible to non-admin roles'",
      },
      { kind: "trace", summary: "results/traces/t-s8.zip" },
    ],
  },
  {
    testId: "t-s10",
    verdict: "ENV_FLAKE",
    confidence: 0.86,
    rationale:
      "Connection reset during navigation with no application response received. No other test " +
      "touching /cart failed in this shard. Retrying once before reclassifying.",
    evidence: [
      { kind: "network", summary: "net::ERR_CONNECTION_RESET — no HTTP response" },
      {
        kind: "cross-test",
        summary: "t-s3 and t-s12 both loaded /cart successfully in the same run",
      },
    ],
  },
];

// --- healing ------------------------------------------------------------------

const HEALS: HealAttempt[] = [
  {
    testId: "t-s3",
    attempt: 1,
    summary: 'Rewrote the locator to match the renamed control, keeping the assertion intact',
    before: `await page.getByRole('button', { name: 'Add to cart' }).click();\nawait expect(page.getByTestId('cart-badge')).toHaveText('1');`,
    after: `await page.getByRole('button', { name: /add to (cart|bag)/i }).click();\nawait expect(page.getByTestId('cart-badge')).toHaveText('1');`,
    assertionsIntact: true,
    outcome: "healed",
  },
  {
    testId: "t-s10",
    attempt: 1,
    summary:
      "Proposed replacing the quantity assertion with a visibility check — REJECTED by the " +
      "assertion-integrity guard for weakening the assertion",
    before: `await expect(row.getByRole('spinbutton')).toHaveValue('1');`,
    after: `await expect(row.getByRole('spinbutton')).toBeVisible();`,
    assertionsIntact: false,
    outcome: "rejected",
  },
  {
    testId: "t-s10",
    attempt: 2,
    summary:
      "Second attempt added an explicit wait for the cart mutation to settle and kept the " +
      "original assertion",
    before: `await qty.fill('0');\nawait expect(row.getByRole('spinbutton')).toHaveValue('1');`,
    after: `await qty.fill('0');\nawait qty.blur();\nawait page.waitForResponse(r => r.url().includes('/api/cart') && r.ok());\nawait expect(row.getByRole('spinbutton')).toHaveValue('1');`,
    assertionsIntact: true,
    outcome: "healed",
  },
];

const BUGS: FiledBug[] = [
  {
    id: "bug-1",
    testId: "t-s4",
    title: "Checkout returns 500 when paying with a saved card",
    severity: "critical",
    evidence: TRIAGE[1].evidence,
  },
  {
    id: "bug-2",
    testId: "t-s8",
    title: "Admin console is reachable by shopper-role accounts",
    severity: "critical",
    evidence: TRIAGE[2].evidence,
  },
];

const RISKS: RiskItem[] = [
  {
    id: "r1",
    surface: "/forgot-password — password reset flow",
    risk: "critical",
    score: 88,
    reasons: [
      "Reachable in one click from the login page",
      "Touches credentials and sends outbound email",
      "Named in PRD §2.4",
      "Quarantined: side-effecting, needs explicit opt-in",
    ],
  },
  {
    id: "r2",
    surface: "Payment provider iframe — card entry",
    risk: "critical",
    score: 84,
    reasons: [
      "Handles PCI-scope data",
      "Cross-origin iframe with no accessible test hooks",
      "Blocks the expired-card decline scenario",
    ],
  },
  {
    id: "r3",
    surface: "/account/addresses — address book CRUD",
    risk: "high",
    score: 66,
    reasons: [
      "Destructive delete with no confirmation observed during recon",
      "Two clicks from the dashboard",
      "Out of scenario budget this run",
    ],
  },
  {
    id: "r4",
    surface: "Concurrent sessions across devices",
    risk: "medium",
    score: 41,
    reasons: ["Requires two browser contexts", "Deferred by the critic as out of budget"],
  },
  {
    id: "r5",
    surface: "/orders/:id — order history detail",
    risk: "low",
    score: 22,
    reasons: ["Read-only surface", "No mutations observed", "Low PRD emphasis"],
  },
];

const PRD_TRACE: PrdRequirement[] = [
  {
    id: "REQ-1",
    text: "Users can sign in with email and password",
    covered: true,
    coveredBy: ["s1", "s6"],
  },
  {
    id: "REQ-2",
    text: "Invalid credentials must not create a session",
    covered: true,
    coveredBy: ["s6"],
  },
  {
    id: "REQ-3",
    text: "Shoppers can add items to a cart and adjust quantity",
    covered: true,
    coveredBy: ["s3", "s10", "s12"],
  },
  {
    id: "REQ-4",
    text: "Checkout supports saved payment methods",
    covered: true,
    coveredBy: ["s4"],
  },
  {
    id: "REQ-5",
    text: "Admin routes must be inaccessible to non-admin roles",
    covered: true,
    coveredBy: ["s8"],
  },
  {
    id: "REQ-6",
    text: "Declined payments must preserve the cart",
    covered: false,
    coveredBy: [],
  },
  {
    id: "REQ-7",
    text: "Password reset must not disclose account existence",
    covered: false,
    coveredBy: [],
  },
  {
    id: "REQ-8",
    text: "Order history is visible for 24 months",
    covered: false,
    coveredBy: [],
  },
];

const ROUTES = [
  "/",
  "/login",
  "/forgot-password",
  "/products",
  "/products/:slug",
  "/search",
  "/cart",
  "/checkout",
  "/dashboard",
  "/account/addresses",
  "/orders",
  "/admin",
];

// ---------------------------------------------------------------------------
// Script builder
// ---------------------------------------------------------------------------

export function buildMockRun(runId: string, input: RunInput): TimedEvent[] {
  let seq = 0;
  const out: TimedEvent[] = [];
  const t0 = Date.now();
  let clock = 0;

  const push = (delayMs: number, event: OrchestratorEventInit) => {
    clock += delayMs;
    out.push({
      delayMs,
      event: {
        ...event,
        seq: seq++,
        ts: new Date(t0 + clock).toISOString(),
      } as OrchestratorEvent,
    });
  };

  const tool = (
    delayMs: number,
    agent: AgentName,
    toolName: string,
    summary: string,
    ok = true,
  ) => push(delayMs, { type: "agent.tool", agent, tool: toolName, summary, ok });

  push(0, { type: "run.started", runId, input });

  // ---- RECON ---------------------------------------------------------------
  push(400, { type: "stage.entered", stage: "recon", attempt: 1 });
  push(300, {
    type: "agent.thinking",
    agent: "recon",
    text: "Opening the target and establishing a baseline session before crawling.",
  });
  tool(500, "recon", "browser_navigate", `Loaded ${input.url} — 200 OK, 1.2s`);
  tool(420, "recon", "browser_snapshot", "Captured accessibility tree — 84 nodes, 19 interactive");
  if (input.credentials) {
    tool(560, "recon", "browser_fill_form", "Submitted the sign-in form as the supplied user");
    tool(480, "recon", "browser_snapshot", "Authenticated — account menu present, session cookie set");
  }
  tool(600, "recon", "browser_navigate", "Breadth-first crawl, depth 2 — 12 routes discovered");
  push(300, {
    type: "decision",
    stage: "recon",
    action: "Compact each page to an interactive-element digest instead of raw HTML",
    rationale:
      "Raw DOM would consume roughly 40× the tokens and buries the signal. The accessibility " +
      "tree gives deterministic, nameable targets and keeps the planner inside its context budget.",
    confidence: 0.96,
    evidence: [
      { kind: "heuristic", summary: "84 a11y nodes vs ~3,400 DOM nodes on the landing page" },
    ],
  });
  push(250, { type: "recon.ready", routes: ROUTES, authenticated: !!input.credentials });
  push(200, {
    type: "artifact",
    kind: "plan",
    path: "recon.json",
    title: "Recon map — 12 routes, 19 interactive surfaces",
  });
  push(150, { type: "cost", usd: 0.21, tokensIn: 18_400, tokensOut: 2_100 });
  push(200, { type: "stage.exited", stage: "recon", outcome: "ok", durationMs: 8_400 });

  // ---- PLAN v1 -------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "plan", attempt: 1 });
  push(350, {
    type: "agent.thinking",
    agent: "planner",
    text: input.intent
      ? `Scoping the plan around the stated intent: "${input.intent}".`
      : "No stated intent — planning broadly across every discovered surface.",
  });
  tool(700, "planner", "browser_snapshot", "Re-read /products and /checkout to ground the steps");
  tool(650, "planner", "Write", "specs/shoplite-core.md — 5 scenarios");
  push(300, { type: "plan.ready", attempt: 1, scenarios: PLAN_V1 });
  push(200, {
    type: "artifact",
    kind: "plan",
    path: "specs/shoplite-core.md",
    title: "Test plan v1 — 5 scenarios",
  });
  push(150, { type: "cost", usd: 0.34, tokensIn: 22_800, tokensOut: 4_600 });
  push(200, { type: "stage.exited", stage: "plan", outcome: "ok", durationMs: 11_200 });

  // ---- CRITIQUE 1 → replan -------------------------------------------------
  push(300, { type: "stage.entered", stage: "critique", attempt: 1 });
  push(400, {
    type: "agent.thinking",
    agent: "critic",
    text: "Scoring the plan against the coverage rubric using the recon map as ground truth.",
  });
  push(700, { type: "critique.ready", critique: CRITIQUE_V1 });
  push(300, {
    type: "decision",
    stage: "critique",
    action: "Reject the plan and re-plan with 7 targeted directives",
    rationale:
      "Coverage scored 61/100. Five of six rubric dimensions are below threshold and the plan is " +
      "effectively all happy-path. Recon proved four uncovered surfaces exist, so these are real " +
      "omissions rather than scope choices. Re-planning is cheaper than generating a suite that " +
      "would give the team false confidence.",
    confidence: 0.93,
    evidence: [
      { kind: "heuristic", summary: "negative-paths 20/100, error-states 25/100" },
      { kind: "heuristic", summary: "Recon found /forgot-password, /admin and an empty-cart state, none planned" },
    ],
  });
  push(250, {
    type: "stage.exited",
    stage: "critique",
    outcome: "replan",
    durationMs: 6_100,
  });

  // ---- PLAN v2 -------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "plan", attempt: 2 });
  push(350, {
    type: "agent.thinking",
    agent: "planner",
    text: "Applying the critic's directives — adding negative, permission, edge and destructive cases.",
  });
  tool(600, "planner", "browser_navigate", "Probed /admin as a shopper to confirm it is reachable");
  tool(550, "planner", "Write", "specs/shoplite-core.md — revised to 15 scenarios");
  push(300, { type: "plan.ready", attempt: 2, scenarios: PLAN_V2 });
  push(200, {
    type: "artifact",
    kind: "plan",
    path: "specs/shoplite-core.md",
    title: "Test plan v2 — 15 scenarios (10 added by critique)",
  });
  push(150, { type: "cost", usd: 0.41, tokensIn: 26_100, tokensOut: 7_300 });
  push(200, { type: "stage.exited", stage: "plan", outcome: "ok", durationMs: 12_800 });

  // ---- CRITIQUE 2 → pass ---------------------------------------------------
  push(300, { type: "stage.entered", stage: "critique", attempt: 2 });
  push(650, { type: "critique.ready", critique: CRITIQUE_V2 });
  push(300, {
    type: "decision",
    stage: "critique",
    action: "Accept the plan at 88/100 and proceed to generation",
    rationale:
      "All seven gaps are addressed and every rubric dimension clears threshold. The two " +
      "remaining gaps are recorded as accepted rather than silently dropped — they will appear " +
      "in the risk ledger so the team knows what was traded away.",
    confidence: 0.9,
    evidence: [
      { kind: "heuristic", summary: "Coverage 61 → 88 after one re-plan" },
      { kind: "heuristic", summary: "7 of 7 gaps resolved; 2 new gaps accepted as out of budget" },
    ],
  });
  push(200, { type: "stage.exited", stage: "critique", outcome: "ok", durationMs: 5_400 });

  // ---- GENERATE ------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "generate", attempt: 1 });
  push(350, {
    type: "agent.thinking",
    agent: "generator",
    text: "Every locator must resolve on the live page before it is written to a file.",
  });
  tool(450, "generator", "Write", "tests/seed.spec.ts — session bootstrap");

  for (const t of GENERATED) {
    tool(
      260,
      "generator",
      "browser_generate_locator",
      `${t.title} — ${t.selectorsVerified}/${t.selectorsTotal} locators resolved`,
    );
    push(160, { type: "test.generated", test: t });
    push(90, { type: "artifact", kind: "test", path: t.file, title: t.title });
  }

  for (const q of QUARANTINED) {
    tool(
      300,
      "generator",
      "browser_verify_element_visible",
      `${q.title} — could not resolve required elements`,
      false,
    );
    push(220, {
      type: "decision",
      stage: "generate",
      action: `Quarantine "${q.title}" instead of emitting a guessed selector`,
      rationale: q.reason,
      confidence: 0.89,
      evidence: [
        {
          kind: "selector-provenance",
          summary: "Required element absent from the live accessibility snapshot",
        },
      ],
    });
  }

  push(300, {
    type: "decision",
    stage: "generate",
    action: "Ship 12 verified tests; hold 3 scenarios in quarantine",
    rationale:
      "A suite where every selector is proven is worth more than a larger suite with guessed " +
      "locators. The 3 held scenarios are reported with reasons rather than dropped, so the " +
      "team can unblock them deliberately.",
    confidence: 0.95,
    evidence: [
      { kind: "selector-provenance", summary: "60/60 emitted locators verified against the live page" },
    ],
  });
  push(150, { type: "cost", usd: 1.12, tokensIn: 61_400, tokensOut: 22_900 });
  push(200, { type: "stage.exited", stage: "generate", outcome: "ok", durationMs: 46_300 });

  // ---- EXECUTE -------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "execute", attempt: 1 });
  push(300, {
    type: "decision",
    stage: "execute",
    action: `Shard 12 tests across ${input.options.parallelWorkers} workers`,
    rationale:
      "Flows are independent and each test bootstraps its own session through the seed fixture, " +
      "so there is no shared-state hazard. Serial execution would take roughly 4× as long.",
    confidence: 0.92,
    evidence: [{ kind: "heuristic", summary: "No cross-test fixtures or shared mutable state detected" }],
  });
  tool(400, "runner", "Bash", `npx playwright test --workers=${input.options.parallelWorkers} --reporter=json`);

  for (const r of RESULTS_PASS_1) {
    const test = GENERATED.find((t) => t.id === r.testId)!;
    push(340, {
      type: "test.result",
      result: {
        id: `${r.testId}-1`,
        testId: r.testId,
        title: test.title,
        status: r.status,
        durationMs: r.durationMs,
        attempt: 1,
        error: r.error,
      },
    });
    if (r.status === "failed") {
      push(120, {
        type: "artifact",
        kind: "trace",
        path: `results/traces/${r.testId}.zip`,
        title: `Trace — ${test.title}`,
      });
    }
  }
  push(200, { type: "cost", usd: 0.08, tokensIn: 4_200, tokensOut: 900 });
  push(200, { type: "stage.exited", stage: "execute", outcome: "ok", durationMs: 38_700 });

  // ---- TRIAGE --------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "triage", attempt: 1 });
  push(400, {
    type: "agent.thinking",
    agent: "classifier",
    text: "Assembling an evidence bundle per failure — snapshot diff, console, network, provenance.",
  });

  for (const outcome of TRIAGE) {
    tool(320, "classifier", "browser_snapshot", `Re-snapshotted the failure page for ${outcome.testId}`);
    push(280, { type: "triage.verdict", outcome });
  }

  push(300, {
    type: "decision",
    stage: "triage",
    action: "Withhold the Healer from 2 of 4 failures",
    rationale:
      "t-s4 and t-s8 are classified as genuine application defects at 0.97 and 0.91 confidence. " +
      "Healing a real defect deletes the exact signal the suite exists to produce, so these stay " +
      "red and are filed as bugs. Only t-s3 (script drift) is routed to the Healer; t-s10 is " +
      "retried once as a suspected flake.",
    confidence: 0.94,
    evidence: [
      { kind: "http-status", summary: "t-s4: POST /api/orders → 500 with a server-side TypeError" },
      { kind: "http-status", summary: "t-s8: GET /admin → 200 for role=shopper" },
      { kind: "snapshot-diff", summary: "t-s3: control renamed 'Add to cart' → 'Add to bag'" },
    ],
  });

  for (const bug of BUGS) {
    push(220, { type: "bug.filed", bug });
  }
  push(150, { type: "cost", usd: 0.47, tokensIn: 31_700, tokensOut: 6_800 });
  push(200, { type: "stage.exited", stage: "triage", outcome: "ok", durationMs: 14_900 });

  // ---- HEAL ----------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "heal", attempt: 1 });

  push(400, {
    type: "agent.thinking",
    agent: "healer",
    text: "Replaying t-s3 step by step against the live page to locate the equivalent control.",
  });
  tool(420, "healer", "browser_snapshot", "Found button 'Add to bag' at the expected position");
  push(300, { type: "heal.attempted", attempt: HEALS[0] });
  push(200, {
    type: "artifact",
    kind: "patch",
    path: "heal/patch-t-s3-1.diff",
    title: "Healed — Add an item to the cart",
  });
  push(280, {
    type: "test.result",
    result: {
      id: "t-s3-2",
      testId: "t-s3",
      title: "Add an item to the cart",
      status: "healed",
      durationMs: 2_260,
      attempt: 2,
    },
  });

  push(380, {
    type: "agent.thinking",
    agent: "healer",
    text: "Retrying t-s10 after the suspected flake, then repairing the timing assumption.",
  });
  push(300, { type: "heal.attempted", attempt: HEALS[1] });
  push(320, {
    type: "decision",
    stage: "heal",
    action: "Reject the Healer's patch for t-s10 — it weakened an assertion",
    rationale:
      "The proposed patch replaced toHaveValue('1') with toBeVisible(). That would make the test " +
      "pass without verifying the behaviour it exists to verify. The assertion-integrity guard " +
      "rejects any patch that deletes, loosens or retargets an assertion; the Healer may only " +
      "change locators and waits.",
    confidence: 0.99,
    evidence: [
      {
        kind: "assertion-diff",
        summary: "toHaveValue('1') → toBeVisible() — matcher weakened, expected value dropped",
      },
    ],
  });
  push(300, { type: "heal.attempted", attempt: HEALS[2] });
  push(200, {
    type: "artifact",
    kind: "patch",
    path: "heal/patch-t-s10-2.diff",
    title: "Healed — Reject a cart quantity of zero",
  });
  push(280, {
    type: "test.result",
    result: {
      id: "t-s10-3",
      testId: "t-s10",
      title: "Reject a cart quantity of zero",
      status: "healed",
      durationMs: 3_980,
      attempt: 3,
    },
  });
  push(150, { type: "cost", usd: 0.62, tokensIn: 28_900, tokensOut: 9_400 });
  push(200, { type: "stage.exited", stage: "heal", outcome: "ok", durationMs: 22_100 });

  // ---- REPORT --------------------------------------------------------------
  push(300, { type: "stage.entered", stage: "report", attempt: 1 });
  push(450, {
    type: "agent.thinking",
    agent: "orchestrator",
    text: "Synthesising coverage, outcomes, healer actions, residual gaps and untested-flow risk.",
  });

  const finalResults: TestResult[] = [
    ...RESULTS_PASS_1.filter((r) => !["t-s3", "t-s10"].includes(r.testId)).map((r) => {
      const test = GENERATED.find((t) => t.id === r.testId)!;
      return {
        id: `${r.testId}-1`,
        testId: r.testId,
        title: test.title,
        status: r.status,
        durationMs: r.durationMs,
        attempt: 1,
        error: r.error,
      };
    }),
    {
      id: "t-s3-2",
      testId: "t-s3",
      title: "Add an item to the cart",
      status: "healed",
      durationMs: 2_260,
      attempt: 2,
    },
    {
      id: "t-s10-3",
      testId: "t-s10",
      title: "Reject a cart quantity of zero",
      status: "healed",
      durationMs: 3_980,
      attempt: 3,
    },
    ...QUARANTINED.map((q, i) => ({
      id: `q-${i}`,
      testId: `q-${q.scenarioId}`,
      title: q.title,
      status: "quarantined" as const,
      durationMs: 0,
      attempt: 0,
      error: q.reason,
    })),
  ];

  const report: TestQualityReport = {
    runId,
    url: input.url,
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date(t0 + clock + 1500).toISOString(),
    durationMs: 214_600,
    costUsd: 3.25,
    coverageScore: 88,
    scenariosPlanned: PLAN_V2.length,
    scenariosGenerated: GENERATED.length,
    scenariosQuarantined: QUARANTINED.length,
    passed: 10,
    failed: 2,
    healed: 2,
    replans: 1,
    healAttempts: HEALS.length,
    scenarios: PLAN_V2,
    results: finalResults,
    triage: TRIAGE,
    heals: HEALS,
    bugs: BUGS,
    remainingGaps: CRITIQUE_V2.gaps,
    risks: RISKS,
    prd: input.prd ? PRD_TRACE : undefined,
  };

  push(600, {
    type: "decision",
    stage: "report",
    action: "Publish the suite with 2 tests left red",
    rationale:
      "Both red tests are confirmed application defects, not script problems. Leaving them red is " +
      "the correct outcome — a green suite here would be a lie. Filed as 2 critical bugs with " +
      "traces attached, and the residual risk ledger names 5 surfaces we did not reach.",
    confidence: 0.96,
    evidence: [
      { kind: "heuristic", summary: "10 passed · 2 healed · 2 failed (both APP_DEFECT) · 3 quarantined" },
      { kind: "heuristic", summary: "Coverage 88/100 after 1 re-plan; 2 gaps accepted" },
    ],
  });
  push(300, {
    type: "artifact",
    kind: "plan",
    path: "report.json",
    title: "Test quality report",
  });
  push(200, { type: "stage.exited", stage: "report", outcome: "ok", durationMs: 9_200 });
  push(400, { type: "run.finished", status: "succeeded", report });

  return out;
}

export const MOCK_TARGET_URL = "https://shoplite.demo";

export const RECENT_RUNS = [
  {
    id: "run_8f2a41",
    url: "https://shoplite.demo",
    status: "succeeded" as const,
    startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    scenarios: 15,
    passed: 12,
    failed: 2,
    coverageScore: 88,
  },
  {
    id: "run_7c1b09",
    url: "https://demo.playwright.dev/todomvc",
    status: "succeeded" as const,
    startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    scenarios: 11,
    passed: 11,
    failed: 0,
    coverageScore: 91,
  },
  {
    id: "run_5d9e77",
    url: "https://saucedemo.com",
    status: "failed" as const,
    startedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    scenarios: 9,
    passed: 6,
    failed: 3,
    coverageScore: 74,
  },
];
