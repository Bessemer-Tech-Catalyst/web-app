/**
 * Deterministic agent fixtures.
 *
 * Phase 2 runs the real orchestrator over stubbed agents, so the state machine, the
 * event log, the transport and the UI can all be finished and hardened before a single
 * model call exists. These are the values the stubs return; Phases 3–6 replace the
 * stubs one at a time and delete from here as they go.
 *
 * The data deliberately exercises every branch the FSM has: a critique that rejects its
 * own plan, scenarios quarantined for unprovable selectors, a heal, a genuine app
 * defect that must NOT be healed, a flake, and a patch the assertion guard rejects.
 */

import type {
  Critique,
  FiledBug,
  GeneratedTest,
  PrdRequirement,
  Scenario,
  TestResult,
  TriageOutcome,
} from "@/lib/types";

export const PLAN_V1: Scenario[] = [
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

export const CRITIQUE_V1: Critique = {
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

export const NEW_IN_V2: Scenario[] = [
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

export const PLAN_V2: Scenario[] = [...PLAN_V1, ...NEW_IN_V2];

export const CRITIQUE_V2: Critique = {
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

export const GENERATED: GeneratedTest[] = [
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

export const QUARANTINED = [
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

export interface ResultSpec {
  testId: string;
  status: TestResult["status"];
  durationMs: number;
  error?: string;
}

export const RESULTS_PASS_1: ResultSpec[] = [
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

export const TRIAGE: TriageOutcome[] = [
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

export const BUGS: FiledBug[] = [
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

/**
 * There was a `RISKS` fixture here — five hand-written sentences about an application
 * nobody had looked at, printed under whatever target the run was actually pointed at.
 * Phase 6 deleted it: the risk ledger's scoring layer is arithmetic over a route list
 * and needs no model, so `stubAgents.assessRisk` computes the real thing offline
 * (`agents/risk.ts`, `computeLedger`). A fixture is only honest where the alternative
 * costs a model call.
 */

export const PRD_TRACE: PrdRequirement[] = [
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

export const ROUTES = [
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

export const TARGET_URL = "https://shoplite.demo";

/** A patch proposal from the Healer, before the orchestrator's guard runs on it. */
export interface HealProposal {
  testId: string;
  summary: string;
  before: string;
  after: string;
  /**
   * The workspace-relative spec file the patch applies to.
   *
   * Absent on the fixture proposals below, which describe a heal rather than performing
   * one. A real proposal carries it because the orchestrator — not the Healer — is what
   * writes an accepted patch to disk, and it needs to be told where.
   */
  file?: string;
}

/**
 * What the Healer *proposes*. Note the second entry: it weakens an assertion, and the
 * orchestrator's guard — not this file — is what catches it.
 */
export const HEAL_PROPOSALS: Record<string, HealProposal[]> = {
  "t-s3": [
    {
      testId: "t-s3",
      summary: "Rewrote the locator to match the renamed control, keeping the assertion intact",
      before:
        "await page.getByRole('button', { name: 'Add to cart' }).click();\nawait expect(page.getByTestId('cart-badge')).toHaveText('1');",
      after:
        "await page.getByRole('button', { name: /add to (cart|bag)/i }).click();\nawait expect(page.getByTestId('cart-badge')).toHaveText('1');",
    },
  ],
  "t-s10": [
    {
      testId: "t-s10",
      summary: "Proposed relaxing the quantity check to a visibility check",
      before: "await expect(row.getByRole('spinbutton')).toHaveValue('1');",
      after: "await expect(row.getByRole('spinbutton')).toBeVisible();",
    },
    {
      testId: "t-s10",
      summary:
        "Second attempt waits for the cart mutation to settle and keeps the original assertion",
      before:
        "await qty.fill('0');\nawait expect(row.getByRole('spinbutton')).toHaveValue('1');",
      after:
        "await qty.fill('0');\nawait qty.blur();\nawait page.waitForResponse(r => r.url().includes('/api/cart') && r.ok());\nawait expect(row.getByRole('spinbutton')).toHaveValue('1');",
    },
  ],
};

/** Result of re-running a test after a patch the guard accepted. */
export const HEAL_RERUNS: Record<string, { durationMs: number }> = {
  "t-s3": { durationMs: 2_260 },
  "t-s10": { durationMs: 3_980 },
};
