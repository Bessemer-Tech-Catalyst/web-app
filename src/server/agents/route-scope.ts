/**
 * How much of an unfamiliar application is worth looking at, and which parts.
 *
 * Recon's crawl used to be bounded by a depth cap — "breadth-first to a depth of 2, stop
 * at 20 routes". Depth is the wrong knob, and it is worth being precise about why,
 * because the instinct to raise it is strong and raising it is the expensive mistake.
 *
 * **Real applications are wide, not deep.** n8n.io links 41 distinct paths on its own
 * origin from the landing page alone. At depth 2 that frontier is in the hundreds; at
 * depth 4 it is effectively the whole site. So a depth cap is not a budget — the number
 * it bounds is not the number that costs money. What costs money is the count of
 * surfaces snapshotted, because each snapshot is thousands of tokens of accessibility
 * tree, and that count grows with the site's branching factor rather than with the cap.
 *
 * **And most of that width is the same surface.** `/products/1` and `/products/2` are
 * one template rendered twice. Snapshotting both spends the budget twice to learn one
 * thing, and it is exactly what a breadth-first crawl over an index page does first.
 *
 * So the budget here is a count of distinct *route templates*, and the crawl order is a
 * priority queue rather than a queue. Depth survives as a cheap rail against a crawler
 * that walks a paginated archive forever, not as the thing the operator tunes.
 *
 * All of this is deterministic and model-free, which is the point: it is the same
 * arithmetic every run, a reader can recompute it, and it is pinned by `route-scope.test.mts`.
 *
 * Depth itself is not gone, and deliberately so: it is still the number a person reading
 * the Decision Log recognises, and a rail against a crawler that walks a paginated
 * archive forever is worth having independent of the surface count. What changed is that
 * it is no longer a fixed 2 asked for in a paragraph — see `crawlBudget` — it defaults to
 * 2 and widens only when the target's own shape says a real flow sits further in.
 */

import type { Archetype } from "./target-profile";

/** Extensions that are never a surface a test drives. */
const ASSET_EXT =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|xml|txt|rss|atom)$/i;

/** Path segments that are values rather than structure. */
const SEGMENT_RULES: [RegExp, string][] = [
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ":uuid"],
  [/^\d+$/, ":id"],
  [/^[0-9a-f]{24}$/i, ":objectid"],
  [/^[0-9a-f]{32,}$/i, ":hash"],
  // A slug with a trailing numeric id — `my-first-workflow-8213`.
  [/^[\w-]*-\d{3,}$/, ":slug-id"],
  // Dates in a path are archive pagination almost every time.
  [/^\d{4}$/, ":year"],
  [/^(0?[1-9]|1[0-2])$/, ":month"],
  // Long opaque tokens: n8n workflow ids, Stripe ids, nanoids.
  [/^[A-Za-z0-9_-]{16,}$/, ":token"],
  // Medium-length identifiers — the 8-to-15-character nanoids and short hashes a great
  // many applications use for a record in a URL.
  //
  // Deliberately narrow: the segment must contain *both* a letter and a digit, which a
  // hand-written route name almost never does ("settings", "executions", "sign-in") and
  // a generated identifier almost always does. Erring the other way would be the more
  // expensive mistake — collapsing two genuinely different routes into one template
  // makes the crawl skip a real surface, and it skips it silently.
  [/^(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,15}$/, ":token"],
];

/**
 * A path reduced to the surface it represents.
 *
 * `/workflow/8xKpQ2mNvR4tLwYz/executions/1183` becomes `/workflow/:token/executions/:id`,
 * which is the thing a test plan can actually name. Query strings are dropped except for
 * keys that genuinely select a different view — a `?tab=` is a surface, a `?utm_source=`
 * is the same page with a tracking tag, and treating the second as new is how a crawl
 * spends twenty snapshots on one page.
 */
/*
 * Known limitation, stated rather than hidden: an application that mints ids in two
 * different shapes — `/workflow/44` beside `/workflow/8xKpQ2mNvR4tLwYz` — produces two
 * templates for one surface, so the crawl pays twice for it. Real applications are
 * consistent about this, and the failure is a wasted surface rather than a wrong result,
 * which is the right side to be wrong on.
 */
export function routeTemplate(pathname: string, search = ""): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((raw) => {
      const seg = decodeURIComponent(raw);
      for (const [re, label] of SEGMENT_RULES) if (re.test(seg)) return label;
      return seg.toLowerCase();
    });

  let template = `/${segments.join("/")}`;
  if (template.length > 1 && template.endsWith("/")) template = template.slice(0, -1);

  const view = viewKeys(search);
  return view ? `${template}?${view}` : template;
}

/**
 * Query keys that change what is on the page, as `key=value` pairs, sorted.
 *
 * An allowlist rather than a blocklist of tracking parameters: an unrecognised key is
 * far more likely to be a campaign tag than a view selector, and the cost of being wrong
 * is asymmetric — a missed view is one surface the plan does not cover and the risk
 * ledger reports; a tracking tag treated as a view is an unbounded number of duplicate
 * snapshots.
 */
const VIEW_KEYS = new Set(["tab", "view", "mode", "status", "filter", "type", "step", "state"]);

function viewKeys(search: string): string {
  if (!search || search === "?") return "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const kept = [...params.entries()]
    .filter(([k]) => VIEW_KEYS.has(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
    .sort();
  return kept.join("&");
}

export interface ScopeRules {
  /** The origin the run was pointed at. */
  origin: string;
  /** Subdomains of this are in scope; anything else is not. */
  registrableDomain: string;
  /** Paths `robots.txt` asked automated clients to leave alone. */
  robotsDisallow?: string[];
}

export type ScopeVerdict =
  | { inScope: true; template: string }
  | { inScope: false; reason: string };

/** Whether one discovered URL is a surface this run may look at. */
export function inScope(href: string, rules: ScopeRules): ScopeVerdict {
  let u: URL;
  try {
    u = new URL(href, rules.origin);
  } catch {
    return { inScope: false, reason: "not a resolvable URL" };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { inScope: false, reason: `${u.protocol} is not a browsable scheme` };
  }

  const host = u.hostname.toLowerCase();
  const domain = rules.registrableDomain.toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) {
    return { inScope: false, reason: `${u.host} is outside ${rules.registrableDomain}` };
  }

  if (ASSET_EXT.test(u.pathname)) {
    return { inScope: false, reason: "a static asset, not a surface" };
  }

  for (const rule of rules.robotsDisallow ?? []) {
    // robots.txt prefix matching, with `*` as its only wildcard.
    const prefix = rule.replace(/\*+$/, "");
    if (prefix && u.pathname.startsWith(prefix)) {
      return { inScope: false, reason: `robots.txt disallows ${rule}` };
    }
  }

  return { inScope: true, template: routeTemplate(u.pathname, u.search) };
}

/**
 * How promising an unvisited surface looks, 0–100.
 *
 * Breadth-first order is arrival order, which on a marketing site means the crawl spends
 * its whole budget on the footer. This ranks the frontier by what a *test plan* would
 * want: the application's own functional surfaces first, its marketing and legal pages
 * last. The scores are coarse on purpose — the ordering matters and the numbers do not.
 */
export function frontierScore(template: string): number {
  const path = template.split("?")[0];
  const depth = path.split("/").filter(Boolean).length;

  let score = 50;

  // The application proper. These are where flows with consequences live.
  if (/\b(workflow|automation|editor|canvas|pipeline|flow)s?\b/.test(path)) score += 35;
  if (/\b(dashboard|app|home|overview|console|studio|workspace)s?\b/.test(path)) score += 30;
  if (/\b(project|credential|connection|integration|node|template)s?\b/.test(path)) score += 25;
  if (/\b(setting|profile|account|team|member|user|admin)s?\b/.test(path)) score += 22;
  if (/\b(execution|run|job|history|log|activity)s?\b/.test(path)) score += 22;
  if (/\b(cart|basket|checkout|order|payment|billing|subscription)s?\b/.test(path)) score += 30;
  if (/\b(product|item|catalog|search|result)s?\b/.test(path)) score += 18;

  // The way in. Worth seeing early even when we already hold a session — the signed-out
  // behaviour of a protected route is a scenario, and this is where it is observed.
  if (/\b(login|signin|sign-in|auth|register|signup|sign-up|logout|reset|forgot)\b/.test(path)) score += 28;

  // A parameterised surface is a real view of real data and usually the richest page on
  // the site — but one instance of it is enough, which `routeTemplate` already ensures.
  if (/:(id|uuid|token|slug-id|objectid|hash)/.test(template)) score += 12;
  // An explicit view selector is a distinct state worth its own look.
  if (template.includes("?")) score += 8;

  // Content and boilerplate. Real pages, rarely worth a scenario, and numerous enough to
  // eat an entire budget if they are not pushed down the queue.
  if (/\b(blog|news|press|article|post|story|stories|case-stud|customer|webinar|event|podcast|newsletter)/.test(path)) score -= 30;
  if (/\b(legal|privacy|terms|cookie|imprint|gdpr|dpa|security|compliance|licen[cs]e)/.test(path)) score -= 35;
  if (/\b(career|job|hiring|about|team|contact|partner|affiliate|community|forum|expert)/.test(path)) score -= 25;
  if (/\b(docs?|documentation|guide|tutorial|reference|api-?ref|changelog|faq|help|support)/.test(path)) score -= 20;
  if (/\b(pricing|plan|compare|why-|vs-|alternative)/.test(path)) score -= 10;

  // The landing page is already visited by definition; everything else pays for depth.
  score -= Math.max(0, depth - 1) * 6;

  return Math.max(0, Math.min(100, score));
}

export interface CrawlBudget {
  /** Distinct route templates Recon may snapshot, the landing page included. */
  maxSurfaces: number;
  /**
   * Link-hops from the landing page Recon may follow. **2 by default** — a link depth
   * still matters as a rail against a crawler walking off into an archive, and a person
   * reading the Decision Log wants a number they recognise, not just a template count.
   *
   * It moves from 2 only when the shape of the target says a real flow needs it to:
   * a workflow builder or a dashboard nests a genuine, testable state three or four
   * links from the landing page (workspace → project → workflow → execution), and a
   * signed-in session opens a second half of the application the marketing shell never
   * links at all. The surface budget above is still the number that actually stops the
   * crawl — this is the shape of *how* it is spent, not a second independent ceiling.
   */
  maxDepth: number;
}

/** The base depth for an application of this shape, before the authenticated bump. */
function baseDepthFor(archetype: Archetype): number {
  switch (archetype) {
    // These two are where a real flow routinely sits three or four links deep — a
    // workflow open inside a project inside a workspace, a record inside a list inside
    // a section. Depth 2 would stop at the list and never reach the flow.
    case "workflow-builder":
    case "saas-dashboard":
      return 3;
    // Content, docs, a storefront's browse-and-buy — the default holds.
    default:
      return 2;
  }
}

/**
 * A crawl budget sized to the target rather than to a slider.
 *
 * Two numbers, and they answer two different questions. `maxSurfaces` is *how much* —
 * the actual ceiling, because a client-rendered application costs more per surface
 * (every navigation needs a settle and a re-snapshot) and a signed-in one has two
 * applications to map, and those are what the money on the table actually buys.
 * `maxDepth` is *how far* — a default of 2, nudged out to 3 for an application whose own
 * shape says a testable state lives that far from the landing page, and one further
 * again once there is a session to explore behind. It is a rail, not the budget: the
 * surface count is what actually stops the crawl, so a wrong depth costs a slightly odd
 * route, never a runaway one.
 */
export function crawlBudget(args: {
  discoveredPaths: number;
  rendering: "server" | "client" | "unknown";
  /** True when the run holds credentials: there is a signed-in half to map as well. */
  authenticated: boolean;
  /** The run's spend ceiling, which is the one budget the operator does set. */
  budgetUsd: number;
  /** The preflight's read on what kind of application this is. Defaults to unknown. */
  archetype?: Archetype;
}): CrawlBudget {
  // Roughly a tenth of the run's money is Recon's, and a surface costs on the order of a
  // cent to visit, settle and summarise. Bounded at both ends so neither a $0.50 run nor
  // a $25 one produces a crawl that is not worth having.
  let maxSurfaces = Math.round(Math.max(8, Math.min(40, args.budgetUsd * 6)));

  if (args.rendering === "client") maxSurfaces = Math.round(maxSurfaces * 0.7);
  // A signed-in application has two applications in it. Spend more, not the same.
  if (args.authenticated) maxSurfaces = Math.round(maxSurfaces * 1.25);
  // Never plan to visit more than the site appears to have, plus room for what is only
  // reachable once signed in or from a page the shell did not link.
  maxSurfaces = Math.max(6, Math.min(maxSurfaces, args.discoveredPaths + 12));

  const maxDepth = Math.min(
    4,
    baseDepthFor(args.archetype ?? "unknown") + (args.authenticated ? 1 : 0),
  );

  return { maxSurfaces, maxDepth };
}

/** The most illustrative real path the shell revealed — the deepest one, ties broken by first seen. */
export function deepestPath(paths: string[]): string | undefined {
  let best: string | undefined;
  let bestDepth = -1;
  for (const p of paths) {
    const depth = p.split("/").filter(Boolean).length;
    if (depth > bestDepth) {
      best = p;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * The crawl instructions Recon is given, derived from the budget above.
 *
 * Written as a method rather than as numbers because the number alone does not tell the
 * agent how to spend it — "20 routes" and "20 routes, deduplicated by template, best
 * first" produce very different crawls of the same site.
 *
 * `discoveredPaths` — the shell's own links, from the preflight — is what turns "3 links
 * deep" from an abstract ceiling into a concrete instruction: naming a real path this
 * site already exposes and saying how deep *that* one is tells the agent what the number
 * means for this application, rather than leaving it to guess against an average one.
 */
export function crawlBriefing(
  budget: CrawlBudget,
  rules: ScopeRules,
  discoveredPaths: string[] = [],
): string {
  const example = deepestPath(discoveredPaths);
  const exampleDepth = example ? example.split("/").filter(Boolean).length : undefined;

  return [
    "## How far to crawl",
    "",
    `Visit at most **${budget.maxSurfaces} distinct surfaces**, and no more than **${budget.maxDepth} links deep** ` +
      "from the landing page. The surface count is the real budget — it is what actually stops the crawl, and " +
      "it is enforced, not merely stated. Depth is a rail alongside it, sized to this application: " +
      (example
        ? `the landing page already links \`${example}\` (${exampleDepth} link(s) in), which is the kind of ` +
          `surface the depth budget exists to reach — go that far when a flow actually leads there, and no ` +
          `further chasing an archive or a pagination trail.`
        : "go that far when a flow actually leads there, and no further chasing an archive or a pagination trail."),
    "",
    "**A surface is a route template, not a URL.** `/workflow/8xKpQ2/executions/1183` and " +
      "`/workflow/9zLmN4/executions/77` are the same surface seen twice: the same template, the same layout, " +
      "the same controls, and nothing a test plan could say about one that it could not say about the other. " +
      "Visit one instance of a template and move on. A crawl that snapshots the first ten rows of a list has " +
      "spent half its budget learning one thing.",
    "",
    "**Spend the budget on the application, not on the website around it.** Prefer surfaces where a user " +
      "*does* something — an editor, a dashboard, a settings page, a checkout, a list with controls on it — " +
      "over surfaces they only read. Blog posts, legal pages, careers, changelogs and documentation are real " +
      "pages and almost never worth a scenario; visit at most one to confirm it exists and note the rest as " +
      "seen-but-not-explored.",
    "",
    `**Stay inside ${rules.registrableDomain}.** Subdomains of it are the same application and are in scope. ` +
      "Any other host is somebody else's site: do not follow the link.",
    "",
    "**Report what you skipped and why.** A surface you saw and chose not to visit is not a gap in the map — " +
      "it is a decision, and the risk ledger will rank it as an untested surface with your reason attached. " +
      "Saying 'twelve blog article templates, not explored' is worth more to the plan than twelve snapshots of " +
      "blog articles.",
  ].join("\n");
}
