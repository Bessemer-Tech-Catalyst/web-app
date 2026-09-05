/**
 * The crawl budget, enforced rather than requested.
 *
 * Everything about scope in this pipeline used to be prose: "crawl breadth-first to a
 * depth of 2… stop at 20 routes". That is a suggestion. A model usually honours it and
 * sometimes does not, and the failure is silent in both directions — an under-crawl
 * arrives as a short `routes` list, an over-crawl as a bill. Neither shows up as an error,
 * which is the worst property a control can have.
 *
 * The submission's own argument is that the controls in this system are mechanical, not
 * prompted: the locator-provenance gate, the assertion-integrity guard, the citation
 * index check. Each of those is a rule the model cannot talk its way past. Crawl scope
 * was the conspicuous exception, and this is the fix — the rule now lives between the
 * agent and the browser rather than in the paragraph asking it nicely.
 *
 * `MCPServerStdio.callTool` is the seam. Every browser action an agent takes goes through
 * it, so a subclass that inspects `browser_navigate` sees every navigation before it
 * happens and can refuse one. That subclass lives in `./playwright-mcp.ts`; this module
 * holds only the rule, and holds no import of the Agents SDK, so the whole policy can be
 * exercised by `navigation-guard.test.mts` with no subprocess and no browser.
 *
 * **A refusal is a tool result, not an exception.** This matters more than it looks. A
 * throw would abort the agent's turn and, since nothing above retries a wedged crawl, the
 * stage and then the run. A refusal *with a reason* is something the model reads and
 * adapts to: it goes somewhere else, and the run continues with a crawl that stayed
 * inside its budget. The text is deliberately shaped like Playwright MCP's own errors —
 * it begins `### Error` — so `harness.ts` already counts it as a failed tool call and the
 * Decision Log shows the refusal instead of hiding it.
 */

// Imported with its extension so this module loads unchanged under `node --test`, which
// resolves ESM specifiers literally. The project sets `allowImportingTsExtensions`, so
// this is the same specifier to the compiler and to the bundler.
import { inScope, type ScopeRules } from "./route-scope.ts";

/** One refused navigation, kept so the run can report what it would not look at. */
export interface Refusal {
  url: string;
  reason: string;
  at: number;
}

export interface GuardOptions extends ScopeRules {
  /** Distinct route templates this agent may visit. */
  maxSurfaces: number;
  /**
   * Whether exceeding the surface budget is enforced.
   *
   * On for Recon, which is the stage that crawls. Off for the Generator and the Healer,
   * which revisit surfaces the plan already named and must not be told they are out of
   * budget for a page the plan is about — a scenario refused a navigation quarantines,
   * and quarantining a scenario for a *budget* reason would be reported to a reader as
   * an unprovable locator, which is a lie. They keep the host scope; they lose the cap.
   */
  enforceBudget: boolean;
  /** Called on every decision, so the orchestrator can narrate without polling. */
  onDecision?: (d: { url: string; template?: string; allowed: boolean; reason?: string }) => void;
}

/**
 * The visited-template ledger and the rule over it.
 *
 * Kept as its own object rather than living inside the server subclass so the whole
 * policy can be tested without an SDK, a subprocess or a browser — see
 * `navigation-guard.test.mts`.
 */
export class NavigationGuard {
  /** Route templates visited, in arrival order. This is the number the budget bounds. */
  readonly visited = new Set<string>();
  readonly refusals: Refusal[] = [];

  private readonly opts: GuardOptions;
  constructor(opts: GuardOptions) {
    this.opts = opts;
  }

  get surfacesUsed(): number {
    return this.visited.size;
  }
  get budgetLeft(): number {
    return Math.max(0, this.opts.maxSurfaces - this.visited.size);
  }

  /**
   * Decides one navigation and records it.
   *
   * Revisiting a template already seen is always allowed and always free: an agent that
   * has to go back to a list page to reach the next item is doing the right thing, and
   * charging it for the return trip would make the budget punish good crawling.
   */
  check(url: string): { allowed: true; template: string } | { allowed: false; reason: string } {
    const verdict = inScope(url, this.opts);

    if (!verdict.inScope) {
      const reason = `${verdict.reason}. This run is scoped to ${this.opts.registrableDomain}.`;
      this.refusals.push({ url, reason, at: Date.now() });
      this.opts.onDecision?.({ url, allowed: false, reason });
      return { allowed: false, reason };
    }

    const { template } = verdict;
    const seen = this.visited.has(template);

    if (!seen && this.opts.enforceBudget && this.visited.size >= this.opts.maxSurfaces) {
      const reason =
        `the crawl budget of ${this.opts.maxSurfaces} distinct surfaces is spent ` +
        `(${template} would be number ${this.visited.size + 1}). Surfaces already visited: ` +
        `${[...this.visited].slice(0, 12).join(", ")}${this.visited.size > 12 ? ", …" : ""}.`;
      this.refusals.push({ url, reason, at: Date.now() });
      this.opts.onDecision?.({ url, template, allowed: false, reason });
      return { allowed: false, reason };
    }

    this.visited.add(template);
    this.opts.onDecision?.({ url, template, allowed: true });
    return { allowed: true, template };
  }

  /** What the refusal says to the agent. Shaped like a Playwright MCP error on purpose. */
  static refusalText(url: string, reason: string, budgetLeft: number): string {
    return [
      `### Error: navigation to ${url} was refused by the run's scope guard.`,
      "",
      `Reason: ${reason}`,
      "",
      budgetLeft > 0
        ? `You have ${budgetLeft} surface(s) of budget left. Spend them on this application's own ` +
          "functional surfaces rather than on this one, and continue."
        : "Your crawl budget is spent. Stop crawling and report what you have mapped so far — an " +
          "honest partial map with the unexplored surfaces named is the expected outcome here, not a " +
          "failure. Surfaces you saw and could not visit should be listed in your evidence so the risk " +
          "ledger can rank them as untested.",
    ].join("\n");
  }
}
