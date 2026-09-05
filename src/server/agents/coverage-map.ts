/**
 * Which surfaces the run actually exercised — measured, not asserted.
 *
 * The brief's final-report requirement ends with "untested flow risk", and the honest
 * version of that phrase is harder than it looks. The tempting implementation is to ask
 * a model which routes the plan missed; the answer reads well and is unfalsifiable.
 *
 * So coverage here is computed from two things that are already on disk and that nobody
 * gets to argue with:
 *
 *   1. **The emitted test source.** A test that navigates to `/orders` contains the
 *      string `"/orders"` in a file we wrote. That is a fact about the suite, checkable
 *      by anyone reading it.
 *   2. **Whether that test ran.** A scenario in the plan is an intention. A scenario
 *      whose test was quarantined produced no evidence about the application at all, and
 *      calling that "covered" is exactly the lie the risk ledger exists to prevent.
 *
 * Hence three states rather than a boolean. The middle one is the interesting one, and
 * it is the line worth saying on stage: *"your plan covers password reset — but the test
 * was quarantined, so you have no evidence it works."*
 *
 * Routes only. Recon also reports prose observations ("a password-reset link is present
 * on the sign-in page") and turning prose into a surface is a judgment, so it happens in
 * `risk.ts` where the model has to cite the observation it came from. This module stays
 * mechanical, which is what lets a test pin it.
 *
 * Deliberately dependency-free so `coverage-map.test.mts` can load the real thing.
 */

import type {
  CoverageSignal,
  Scenario,
  SurfaceCoverage,
  SurfaceStatus,
} from "@/lib/types";

export type { CoverageSignal, SurfaceCoverage, SurfaceStatus };

export interface CoverageInput {
  /** Recon's route list. The universe of surfaces this run knows exist. */
  routes: string[];
  scenarios: Scenario[];
  /** Scenario id → the emitted `.spec.ts` source. Absent for quarantined scenarios. */
  sources: Record<string, string>;
  /**
   * Scenario ids whose test actually reached the runner, resolved by the caller.
   *
   * Passed in rather than derived from results here, because deriving it means knowing
   * which id conventions a `TestResult` may carry, and that knowledge belongs in exactly
   * one place — `lib/report-join.ts`. Keeping it out is also what lets this module stay
   * dependency-free and therefore directly loadable by its own test.
   */
  executed: string[];
}

export function mapCoverage(input: CoverageInput): SurfaceCoverage[] {
  const executed = new Set(input.executed);
  const ran = (id: string) => executed.has(id);

  return dedupe(input.routes).map((route) => {
    const label = labelOf(route);

    const byNavigation: string[] = [];
    const byControl: string[] = [];
    for (const [testId, source] of Object.entries(input.sources)) {
      if (mentionsPath(source, route)) byNavigation.push(testId);
      else if (label && mentionsControl(source, label)) byControl.push(testId);
    }

    const scenarios = input.scenarios
      .filter((s) => mentionsInProse(scenarioText(s), route, label))
      .map((s) => s.id);

    // Attribution is ordered by how checkable it is: a quoted path in a file we emitted
    // beats a control name in that file, which beats a sentence in the plan.
    const navRan = byNavigation.filter(ran);
    const ctlRan = byControl.filter(ran);
    const proseRan = scenarios.filter(ran);

    if (navRan.length) {
      return {
        surface: route,
        status: "exercised",
        scenarios,
        tests: navRan,
        signal: "navigation",
        basis: `${navRan.length} executed test(s) navigate to ${route}`,
      };
    }
    if (ctlRan.length) {
      return {
        surface: route,
        status: "exercised",
        scenarios,
        tests: ctlRan,
        signal: "control",
        basis: `${ctlRan.length} executed test(s) drive a control named "${label}"`,
      };
    }
    if (proseRan.length) {
      return {
        surface: route,
        status: "exercised",
        scenarios,
        tests: proseRan,
        signal: "scenario-text",
        basis:
          `Covered by scenario ${proseRan.join(", ")}, which ran — though the emitted ` +
          "code does not name this path, so the attribution is the plan's word, not the suite's",
      };
    }
    if (scenarios.length || byNavigation.length || byControl.length) {
      const held = [...new Set([...scenarios, ...byNavigation, ...byControl])];
      return {
        surface: route,
        status: "planned-only",
        scenarios,
        tests: [],
        signal: scenarios.length ? "scenario-text" : "navigation",
        basis:
          `Named by ${held.join(", ")}, none of which produced a test that ran. ` +
          "The plan intends to cover this; the run produced no evidence about it.",
      };
    }
    return { surface: route, status: "untested", scenarios: [], tests: [], signal: "none" };
  });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The path as a quoted string in emitted code.
 *
 * Bounded on both sides deliberately. Unbounded, `/` matches every URL in the file and
 * `/order` matches `/orders`, which would report a surface as exercised on the strength
 * of a prefix. The closing bound allows a query string or a fragment because
 * `goto("/orders?page=2")` is still a visit to `/orders`.
 */
export function mentionsPath(source: string, route: string): boolean {
  const path = normalise(route);
  if (!path) return false;
  if (path === "/") {
    return /(["'`])\/\1/.test(source) || /goto\(\s*(["'`])\/(?:\?|#)/.test(source);
  }
  const re = new RegExp(`(["'\`])${escape(path)}(?:[/?#][^"'\`]*)?\\1`);
  return re.test(source);
}

/**
 * The route's label as an accessible name in emitted code.
 *
 * A suite that reaches `/orders` by clicking a link called "Orders" never writes the
 * path down. Matching the name inside a Playwright name option keeps this from firing on
 * an unrelated word in a comment.
 */
export function mentionsControl(source: string, label: string): boolean {
  const re = new RegExp(
    `name:\\s*(["'\`])[^"'\`]*\\b${escape(label)}\\b[^"'\`]*\\1|` +
      `getBy(?:Text|Label|Title|AltText|Placeholder)\\(\\s*(["'\`])[^"'\`]*\\b${escape(label)}\\b`,
    "i",
  );
  return re.test(source);
}

/** A route named in prose — the path itself, or its label as a whole word. */
export function mentionsInProse(text: string, route: string, label: string): boolean {
  const path = normalise(route);
  if (path && path !== "/" && new RegExp(`${escape(path)}\\b`, "i").test(text)) return true;
  return Boolean(label) && new RegExp(`\\b${escape(label)}\\b`, "i").test(text);
}

/**
 * A route's human label: its last segment, de-slugged.
 *
 * `/account/order-history` → `order history`, which is what a link to it is called and
 * what a scenario calls it. Segments that are obviously identifiers rather than words —
 * `:id`, a uuid, a number — yield nothing, because "42" as a label would match anything.
 */
export function labelOf(route: string): string {
  const last = normalise(route).split("/").filter(Boolean).at(-1) ?? "";
  const word = decodeSafely(last).replace(/[-_]+/g, " ").trim();
  if (!word) return "";
  if (/^[:*{]/.test(word)) return "";
  if (/^\d+$/.test(word)) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(word)) return "";
  return word;
}

/** A route reduced to its path: no origin, no query, no fragment, no trailing slash. */
export function normalise(route: string): string {
  let path = route.trim();
  if (!path) return "";
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(path);
  if (scheme) {
    const rest = path.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    path = slash === -1 ? "/" : rest.slice(slash);
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

const scenarioText = (s: Scenario) =>
  [s.title, s.flow, s.expected, ...s.steps].join(" · ");

function dedupe(routes: string[]): string[] {
  const seen = new Map<string, string>();
  for (const r of routes) {
    const key = normalise(r);
    if (key && !seen.has(key)) seen.set(key, key);
  }
  return [...seen.values()];
}

function decodeSafely(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
