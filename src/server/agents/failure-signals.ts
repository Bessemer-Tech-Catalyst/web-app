/**
 * What the runner's own output says about a failure, before any model reads it.
 *
 * Defect classification is the brief's hardest ask and the one most easily faked: a
 * model handed an error string and asked "is this the script or the app?" will answer
 * confidently either way, and nothing about the answer is checkable. So the classifier
 * here does not start from a blank page. It starts from a **prior** computed by the
 * rules below out of two things neither it nor anything else can argue with:
 *
 *   1. Playwright's own error text — which distinguishes *the element was never found*
 *      from *the element was found and the value was wrong*. That distinction is almost
 *      the whole classification, and it is already in the string.
 *   2. `selector-provenance.json` — whether that exact locator resolved on the live page
 *      at generation time. A locator that Playwright itself handed us twenty minutes ago
 *      and cannot find now is drift; one that never resolved was never evidence.
 *
 * The model may overturn the prior, but only by citing something it observed live that
 * the prior could not see — a 5xx, an uncaught exception, a renamed control. That is the
 * difference between a classifier and a coin flip with a rationale attached.
 *
 * Deliberately dependency-free so `failure-signals.test.mts` can load the real thing.
 */

import type { Evidence, TriageVerdict } from "@/lib/types";

export type SignalKind =
  /** `waiting for locator(…)` — the element never appeared. */
  | "locator-timeout"
  /** The locator matched more than one element. Ambiguous script, healthy app. */
  | "strict-mode"
  /** The element was found; what it said or held was wrong. */
  | "assertion-failed"
  /** Something on top of the target swallowed the click. */
  | "pointer-intercepted"
  /** The navigation itself failed — DNS, connection refused, aborted. */
  | "navigation-failed"
  /** The whole test hit its wall-clock ceiling. */
  | "test-timeout"
  /** The file never ran: a transpile error, a bad import. */
  | "did-not-run"
  /** The page or the browser died under the test. */
  | "page-crash";

export interface FailureSignals {
  kinds: SignalKind[];
  /** The locator the error names, as Playwright printed it. */
  locator?: string;
  matcher?: string;
  expected?: string;
  received?: string;
  /** An HTTP status the error text carries, when it carries one. */
  httpStatus?: number;
}

/** Everything the prior is allowed to know. All of it is on disk before triage runs. */
export interface PriorInput {
  signals: FailureSignals;
  /**
   * Whether the failing locator is in this test's generation-time ledger.
   * `undefined` when there is no provenance record to check against, which is itself
   * worth saying out loud rather than defaulting either way.
   */
  locatorWasProven?: boolean;
  /** Other failing tests whose error names the same locator. */
  alsoFailing: string[];
}

export interface Prior {
  verdict: TriageVerdict;
  /** 0-1. Deliberately never above 0.75: a prior has not looked at the live page. */
  confidence: number;
  /** One sentence, in the Decision Log's voice. */
  why: string;
}

// ---------------------------------------------------------------------------
// Reading the runner
// ---------------------------------------------------------------------------

/**
 * Playwright's error text is highly structured and we lean on that structure rather
 * than on keyword soup. The shapes matched here are the ones it actually emits:
 *
 *   locator.click: Timeout 30000ms exceeded.
 *   Call log:
 *     - waiting for getByRole('button', { name: 'Add to cart' })
 *
 *   Error: expect(locator).toHaveText(expected)
 *   Locator: getByTestId('cart-badge')
 *   Expected string: "1"
 *   Received string: "0"
 *
 *   Error: strict mode violation: getByTestId('todo-title') resolved to 2 elements
 */
export function readSignals(error: string): FailureSignals {
  const kinds: SignalKind[] = [];
  const text = error ?? "";

  if (/strict mode violation/i.test(text)) kinds.push("strict-mode");
  if (/intercepts pointer events|subtree intercepts/i.test(text)) kinds.push("pointer-intercepted");
  if (/net::ERR_|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|page\.goto:.*failed/i.test(text)) {
    kinds.push("navigation-failed");
  }
  if (/Target (page|closed)|crash|Protocol error/i.test(text)) kinds.push("page-crash");
  if (/did not run this file|failed to load|Cannot find module|SyntaxError/i.test(text)) {
    kinds.push("did-not-run");
  }

  const expectMatch = /expect(?:\.soft)?\((?:locator|received)\)\.(?:not\.)?(\w+)/.exec(text);
  if (expectMatch) kinds.push("assertion-failed");

  // `waiting for <locator>` appears in the call log of every actionability timeout, and
  // is the one place the failing locator is named verbatim.
  const waitingFor = /waiting for (.+?)(?:\n|$)/.exec(text);
  if (waitingFor && /Timeout .*exceeded/i.test(text) && !expectMatch) kinds.push("locator-timeout");

  if (/Test timeout of \d+ms exceeded/i.test(text)) kinds.push("test-timeout");

  const locator =
    /(?:^|\n)\s*Locator:\s*(.+?)(?:\n|$)/.exec(text)?.[1]?.trim() ??
    waitingFor?.[1]?.trim().replace(/^locator\s+/, "") ??
    /\b(getBy\w+\([^\n]*?\))\s+resolved to/.exec(text)?.[1];

  const status = /\b(?:status|HTTP)\D{0,3}(\d{3})\b/i.exec(text)?.[1];

  return {
    kinds,
    locator: locator || undefined,
    matcher: expectMatch?.[1],
    expected: capture(text, /Expected (?:string|value|pattern):\s*(.+?)(?:\n|$)/),
    received: capture(text, /Received (?:string|value|pattern|array):\s*(.+?)(?:\n|$)/),
    httpStatus: status ? Number(status) : undefined,
  };
}

const capture = (s: string, re: RegExp) => re.exec(s)?.[1]?.trim();

// ---------------------------------------------------------------------------
// The prior
// ---------------------------------------------------------------------------

/**
 * The rule table, in precedence order. Every branch names the observation it rests on,
 * because `why` is published verbatim as the prior's evidence line and a rationale that
 * cannot be traced to a signal is exactly what this file exists to avoid.
 *
 * Confidences are capped well below 1: a prior has read a string and a ledger. It has
 * not looked at the application. Whatever it says, the live classifier is what decides.
 */
export function priorVerdict(input: PriorInput): Prior {
  const { signals: s, locatorWasProven, alsoFailing } = input;
  const has = (k: SignalKind) => s.kinds.includes(k);
  const shared = alsoFailing.length
    ? ` The same locator fails in ${alsoFailing.length} other test(s), which points at one shared cause rather than ${alsoFailing.length} coincidences.`
    : "";

  if (has("did-not-run")) {
    return {
      verdict: "SCRIPT_DRIFT",
      confidence: 0.7,
      why: "The file never reached the browser — the runner could not load it, so this says nothing about the application.",
    };
  }

  if (has("navigation-failed")) {
    return {
      verdict: "ENV_FLAKE",
      confidence: 0.55,
      why: "Navigation itself failed, which is the target or the network being unreachable rather than a defect in a page that loaded.",
    };
  }

  if (has("page-crash")) {
    return {
      verdict: "APP_DEFECT",
      confidence: 0.5,
      why: "The page or its context died under the test. A browser that crashes on a user flow is the application's problem until proven otherwise.",
    };
  }

  if (has("strict-mode")) {
    return {
      verdict: "SCRIPT_DRIFT",
      confidence: 0.72,
      why: "The locator matched several elements. The page rendered fine; the test's way of naming one element is what is ambiguous.",
    };
  }

  if (has("assertion-failed")) {
    // The element was found and read. That is the interesting case: the app produced a
    // value and the value was wrong, which is what an application defect looks like.
    const found = locatorWasProven !== false;
    return {
      verdict: found ? "APP_DEFECT" : "SCRIPT_DRIFT",
      confidence: found ? 0.6 : 0.45,
      why: found
        ? `The element was located and read — ${s.matcher ?? "the assertion"} expected ${s.expected ?? "one value"} and got ${s.received ?? "another"}. A found element holding the wrong value is the application's answer, not the script's.${shared}`
        : "An assertion failed against a locator this run never resolved on the live page, so the test may be asserting about the wrong element.",
    };
  }

  if (has("pointer-intercepted")) {
    return {
      verdict: "SCRIPT_DRIFT",
      confidence: 0.45,
      why: `Something rendered over the target and swallowed the click. Usually an overlay the test should wait out; occasionally a modal the application never dismisses, which is why this is a low-confidence prior.${shared}`,
    };
  }

  if (has("locator-timeout")) {
    return locatorWasProven
      ? {
          verdict: "SCRIPT_DRIFT",
          confidence: 0.68,
          why: `${s.locator ?? "The locator"} was resolved on this application at generation time and cannot be found now. An element that existed and then moved is the definition of drift.${shared}`,
        }
      : {
          verdict: "SCRIPT_DRIFT",
          confidence: 0.4,
          why: `${s.locator ?? "The locator"} never appeared, and there is no generation-time record of it resolving either, so it is not yet known whether the element moved or never existed.${shared}`,
        };
  }

  if (has("test-timeout")) {
    return {
      verdict: "ENV_FLAKE",
      confidence: 0.4,
      why: "The test ran out of wall clock without naming an element it was waiting for. That is as likely to be a slow environment as anything about the code.",
    };
  }

  return {
    verdict: "SCRIPT_DRIFT",
    confidence: 0.3,
    why: "The runner's error matches no known failure shape, so the prior is weak by construction and the live evidence decides.",
  };
}

/** The deterministic half of the evidence bundle — facts, each traceable to a file. */
export function priorEvidence(input: PriorInput, prior: Prior): Evidence[] {
  const out: Evidence[] = [
    { kind: "heuristic", summary: `Runner signals: ${input.signals.kinds.join(", ") || "none recognised"}`, detail: prior.why },
  ];

  if (input.signals.locator) {
    out.push({
      kind: "selector-provenance",
      summary:
        input.locatorWasProven === undefined
          ? `No provenance record to check \`${input.signals.locator}\` against`
          : input.locatorWasProven
            ? `\`${input.signals.locator}\` was resolved on the live page at generation time`
            : `\`${input.signals.locator}\` is not in this test's generation-time locator ledger`,
      detail: "selector-provenance.json",
    });
  }

  if (input.signals.matcher) {
    out.push({
      kind: "assertion-diff",
      summary: `${input.signals.matcher}: expected ${input.signals.expected ?? "—"}, received ${input.signals.received ?? "—"}`,
    });
  }

  if (input.alsoFailing.length) {
    out.push({
      kind: "cross-test",
      summary: `The same locator also fails in ${input.alsoFailing.join(", ")}`,
      detail: "Correlated failures across independent tests usually share one cause.",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Cross-test correlation
// ---------------------------------------------------------------------------

/**
 * Which other failing tests name the same locator.
 *
 * Cheap, and it is the single strongest tie-breaker we have: one test failing on a
 * button is a test problem, and every test touching that button failing is a page.
 */
export function correlate(
  failures: { testId: string; signals: FailureSignals }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of failures) {
    const others = f.signals.locator
      ? failures
          .filter((g) => g.testId !== f.testId && g.signals.locator === f.signals.locator)
          .map((g) => g.testId)
      : [];
    out.set(f.testId, others);
  }
  return out;
}
