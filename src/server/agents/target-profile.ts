/**
 * What the orchestrator finds out about a target before it spends a token on it.
 *
 * The pipeline was built and tuned against a bundled demo application on localhost. A
 * URL handed over at judging time is a different animal: it may be a marketing site
 * behind Cloudflare with a consent modal over the fold and twenty-one third-party hosts
 * in its footer, or a single-page workflow editor that renders an empty shell and fills
 * it in from JavaScript, or an app that answers 401 until somebody logs in. Each of
 * those breaks a *different* stage, and each is cheap to detect up front — one HTTP
 * request, no browser, no model, no money.
 *
 * So this runs first, and what it learns is not advice. It changes four things
 * mechanically:
 *
 *   - **Crawl scope.** `externalHosts` is what stops Recon's breadth-first crawl from
 *     walking out of the target and into github.com, x.com and a Shopify storefront.
 *   - **The test-id attribute.** See `TEST_ID_ATTRS` below; this one is a silent
 *     suite-killer and it is the reason this module earns its place.
 *   - **Interaction policy.** A production site belonging to somebody else does not get
 *     the same licence to submit forms as a demo app on localhost does.
 *   - **What the agents are told to expect.** A consent overlay is not a UI to test, it
 *     is a door to close first; a bot challenge is a surface that honestly cannot be
 *     tested and should be reported as such rather than fought.
 *
 * Everything here is heuristic and every field says so by being optional. A profile that
 * cannot be built is not an error — the run proceeds with `unreachable` noted, because a
 * target that refuses a plain `fetch` may still open perfectly well in a real browser
 * carrying real headers, and refusing to start on that basis would be worse than useless.
 */

import type { Evidence } from "@/lib/types";

/**
 * Attributes teams actually use for test hooks, most-specific first.
 *
 * This list is the reason this module exists. Playwright's `getByTestId` resolves
 * **`data-testid`** and nothing else unless `testIdAttribute` is configured — and a large
 * share of real applications do not use that spelling. n8n, whose own Playwright config
 * sets `testIdAttribute: 'data-test-id'`, instruments its entire workflow canvas with
 * `data-test-id="canvas-node"`, `data-test-id="execute-workflow-button"` and so on.
 *
 * A Generator that reads `data-test-id="canvas-node"` out of an accessibility snapshot
 * and writes `getByTestId('canvas-node')` has written a locator that matches nothing, and
 * it will do this because that is the idiomatic Playwright spelling. Against such a
 * target *every single test* fails to resolve, every scenario quarantines, and the run
 * publishes an empty report. Detecting the convention and both (a) configuring it and
 * (b) telling the Generator about it turns a total loss into a normal run.
 */
export const TEST_ID_ATTRS = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-cy",
  "data-qa",
  "data-qa-id",
  "data-automation-id",
] as const;

export type TestIdAttr = (typeof TEST_ID_ATTRS)[number];

/**
 * Rough shape of the application, used to bias the plan toward flows that exist.
 *
 * This is a hint and is named like one. A wrong archetype costs a slightly less focused
 * first plan, which the Coverage Critic then corrects; it never gates anything.
 */
export type Archetype =
  | "workflow-builder"
  | "ecommerce"
  | "saas-dashboard"
  | "auth-portal"
  | "content-site"
  | "docs"
  | "unknown";

export type Exposure =
  /** Localhost or a private address: ours to drive, safe to mutate. */
  | "local"
  /** Reachable on the public internet and not obviously a sandbox: somebody else's. */
  | "public";

export interface TargetProfile {
  url: string;
  origin: string;
  host: string;
  /** `n8n.io` for `docs.n8n.io` — the boundary the crawl may not cross. */
  registrableDomain: string;
  exposure: Exposure;

  /** False when even a plain GET did not come back. The run continues anyway. */
  reachable: boolean;
  status?: number;
  /** Set when the target redirected somewhere else — often http→https, or to a login. */
  redirectedTo?: string;

  /** `client` when the shell arrives nearly empty and JavaScript fills it in. */
  rendering: "server" | "client" | "unknown";
  /**
   * The consent platform in front of the content, when one is recognised in the shell.
   *
   * Absent does *not* mean absent: most consent managers are injected at runtime by a
   * tag manager, so they leave nothing in the server-rendered HTML. n8n.io is exactly
   * this case — a Cookie-Script modal covers the page in a real browser and the shell
   * names it nowhere. `consentLikely` is what the briefing actually acts on.
   */
  consentPlatform?: string;
  /**
   * Whether to brief the agents to expect a consent gate at all.
   *
   * True whenever one was recognised, and true for any public target regardless: on the
   * public web a modal over the fold is the norm rather than the exception, and the cost
   * of the two errors is wildly asymmetric. Briefing for a gate that does not appear
   * costs a paragraph nobody uses. Not briefing for one that does costs every click in
   * the run — they land on the overlay and report "element intercepts pointer events",
   * which reads like a broken application rather than an unclosed door.
   */
  consentLikely: boolean;
  /** Bot-mitigation and CAPTCHA vendors detected. Empty is the common case. */
  botProtection: string[];
  /** The test-hook attribute this application uses, when one is detectable. */
  testIdAttr?: TestIdAttr;
  archetype: Archetype;
  /**
   * Subdomains of the target's own registrable domain, linked from the landing page.
   * In scope — an application that keeps its editor on `app.` and its API on `api.` is
   * one product — and listed separately so the briefing never calls them third-party.
   */
  siblingHosts: string[];
  /** Distinct third-party hosts linked from the landing page. Out of scope. */
  externalHosts: string[];
  /** Paths on the target's own origin, as found in the shell. */
  sameOriginPaths: string[];
  /** Whether anything on the landing page looks like a way in. */
  hasAuthSurface: boolean;
  /** Paths `robots.txt` asks crawlers to leave alone. Respected by the crawl scope. */
  robotsDisallow: string[];
  /** How long the plain GET took. A slow shell predicts a slow, timeout-prone run. */
  latencyMs?: number;
  shellBytes?: number;
}

// ---------------------------------------------------------------------------
// Pure analysis. No network, no clock — all of this is pinned by the test file.
// ---------------------------------------------------------------------------

/**
 * The registrable domain, near enough.
 *
 * A real implementation consults the Public Suffix List. This takes the last two labels
 * and stretches to three for the handful of two-part public suffixes that actually turn
 * up in this setting, because the consequence of getting it wrong is bounded: too narrow
 * and the crawl stays on one subdomain, too wide and it may visit a sibling subdomain of
 * the same organisation. Neither loses a run, and neither leaves the target's owner.
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const twoPartSuffixes = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "co.in", "co.nz", "co.za",
    "com.au", "com.br", "com.cn", "com.mx", "com.sg", "com.tr", "net.au",
    "github.io", "vercel.app", "netlify.app", "onrender.com", "fly.dev", "pages.dev",
    "herokuapp.com", "railway.app", "ngrok.io", "ngrok-free.app", "trycloudflare.com",
  ]);
  const lastTwo = labels.slice(-2).join(".");
  return twoPartSuffixes.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** Localhost and the private ranges. Everything else is somebody else's computer. */
export function exposureOf(host: string): Exposure {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0") return "local";
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return "local";
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return "local";
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".test")) return "local";
  return "public";
}

/** Consent-management platforms, recognised by the artefacts they leave in the shell. */
const CONSENT_SIGNS: [RegExp, string][] = [
  [/cookie-?script/i, "Cookie-Script"],
  [/onetrust|optanon/i, "OneTrust"],
  [/cookiebot/i, "Cookiebot"],
  [/usercentrics/i, "Usercentrics"],
  [/quantcast|\bqc-cmp/i, "Quantcast"],
  [/osano/i, "Osano"],
  [/termly/i, "Termly"],
  [/klaro/i, "Klaro"],
  [/didomi/i, "Didomi"],
  [/cookieyes/i, "CookieYes"],
  [/iubenda/i, "Iubenda"],
  [/\bcc-?window\b|cookieconsent/i, "Cookie Consent"],
];

/** Bot mitigation and CAPTCHA vendors. Their presence changes what we promise. */
const BOT_SIGNS: [RegExp, string][] = [
  [/challenges\.cloudflare\.com|cf-turnstile|turnstile/i, "Cloudflare Turnstile"],
  [/recaptcha/i, "reCAPTCHA"],
  [/hcaptcha/i, "hCaptcha"],
  [/datadome/i, "DataDome"],
  [/perimeterx|\bpx-captcha\b/i, "PerimeterX"],
  [/_Incapsula_|incapsula/i, "Imperva Incapsula"],
  [/akam(ai)?[-_]?bot|_abck/i, "Akamai Bot Manager"],
  [/arkoselabs|funcaptcha/i, "Arkose Labs"],
];

/** Archetype keywords, scored by how many hit. Order settles ties, strongest first. */
const ARCHETYPE_SIGNS: [Archetype, RegExp[]][] = [
  [
    "workflow-builder",
    [/\bworkflow(s)?\b/i, /\bautomation\b/i, /\bcanvas\b/i, /\bnode[-\s]?editor\b/i, /\btrigger\b/i, /\bpipeline\b/i, /\bno[-\s]?code\b/i],
  ],
  [
    "ecommerce",
    [/\badd to (cart|basket)\b/i, /\bcheckout\b/i, /\bshopping (cart|bag)\b/i, /\bsku\b/i, /\bproduct(s)?\b/i, /\border(s)?\b/i],
  ],
  [
    "saas-dashboard",
    [/\bdashboard\b/i, /\bworkspace\b/i, /\bproject(s)?\b/i, /\bsettings\b/i, /\bbilling\b/i, /\bteam(s)?\b/i, /\banalytics\b/i],
  ],
  ["docs", [/\bdocumentation\b/i, /\bapi reference\b/i, /\bgetting started\b/i, /\bchangelog\b/i, /\bguide(s)?\b/i]],
  ["auth-portal", [/\bsign in\b/i, /\blog ?in\b/i, /\bforgot password\b/i, /\bsso\b/i, /\btwo[-\s]?factor\b/i]],
  ["content-site", [/\bblog\b/i, /\bpricing\b/i, /\bcareers\b/i, /\bcustomers\b/i, /\btestimonial/i, /\bnewsletter\b/i]],
];

/** Anything that looks like a way in. Drives the "credentials would help here" advice. */
const AUTH_SIGNS =
  /\b(sign|log)\s?-?(in|up)\b|\/login\b|\/signin\b|\/auth\b|\bpassword\b|\bcreate account\b/i;

/**
 * The dominant test-hook attribute in a chunk of markup.
 *
 * Counts occurrences rather than taking the first hit: a page may carry one stray
 * `data-test` from a vendor widget and four hundred `data-test-id`s of its own, and it is
 * the four hundred that the suite has to resolve. Ties break toward the earlier entry in
 * `TEST_ID_ATTRS`, which puts Playwright's own default first — the safest thing to be
 * wrong about, since it is what an unconfigured `getByTestId` already does.
 */
export function detectTestIdAttr(html: string): { attr: TestIdAttr; count: number } | undefined {
  let best: { attr: TestIdAttr; count: number } | undefined;
  for (const attr of TEST_ID_ATTRS) {
    // `(?![\w-])` so `data-test` does not also count every `data-test-id` and
    // `data-testid` on the page and win a majority it did not earn.
    const count = (html.match(new RegExp(`\\b${attr}(?![\\w-])\\s*=`, "gi")) ?? []).length;
    if (count > 0 && (!best || count > best.count)) best = { attr, count };
  }
  return best;
}

/**
 * Every `href` in the shell, split three ways: our own paths, sibling subdomains of the
 * same organisation, and genuinely third-party hosts.
 *
 * The three-way split is not fussiness. With a two-way one, `docs.n8n.io` came back as
 * "third-party" while the policy derived from the same profile declared `*.n8n.io` in
 * scope — so the briefing told the agent to stay on `*.n8n.io` and, four lines later,
 * listed three `n8n.io` subdomains as other people's applications. Contradictory
 * instructions in a prompt are worse than no instructions.
 */
export function linkScope(
  html: string,
  origin: string,
  domain?: string,
): { paths: string[]; siblingHosts: string[]; externalHosts: string[] } {
  const paths = new Set<string>();
  const siblings = new Set<string>();
  const hosts = new Set<string>();
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return { paths: [], siblingHosts: [], externalHosts: [] };
  }
  const scope = (domain ?? registrableDomain(base.hostname)).toLowerCase();

  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const host = u.hostname.toLowerCase();
      if (u.host === base.host) paths.add(u.pathname);
      else if (host === scope || host.endsWith(`.${scope}`)) siblings.add(u.host);
      else hosts.add(u.host);
    } catch {
      /* a malformed href tells us nothing; the crawl will not follow it either */
    }
  }
  return {
    paths: [...paths].sort(),
    siblingHosts: [...siblings].sort(),
    externalHosts: [...hosts].sort(),
  };
}

/**
 * Whether the shell is the page or merely a container for one.
 *
 * The test is the ratio of visible text to markup. A server-rendered page carries its
 * content; a single-page application ships a `<div id="app"></div>` and a megabyte of
 * JavaScript. This matters because an empty accessibility snapshot means two completely
 * different things in the two cases, and Recon is already told to wait and re-snapshot —
 * this is what lets the orchestrator say so with a reason attached.
 */
export function detectRendering(html: string): "server" | "client" | "unknown" {
  if (!html) return "unknown";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (html.length < 1_000) return "unknown";
  // Under ~1.5% visible text, there is essentially nothing in the shell but plumbing.
  return text.length / html.length < 0.015 ? "client" : "server";
}

/** `Disallow:` paths for `User-agent: *`. Other agents' sections are not ours to read. */
export function parseRobots(body: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const line of body.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (applies && key === "disallow" && value) out.push(value);
  }
  return out;
}

/** Matches all the `[re, label]` tables above, deduped and in table order. */
function signsIn(haystack: string, table: [RegExp, string][]): string[] {
  return table.filter(([re]) => re.test(haystack)).map(([, label]) => label);
}

export function detectArchetype(text: string): Archetype {
  let best: { kind: Archetype; hits: number } | undefined;
  for (const [kind, patterns] of ARCHETYPE_SIGNS) {
    const hits = patterns.filter((re) => re.test(text)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { kind, hits };
  }
  return best?.kind ?? "unknown";
}

/** Everything the analysis can say from a shell, its headers and a robots.txt. */
export function analyse(args: {
  url: string;
  finalUrl?: string;
  status?: number;
  headers?: Record<string, string>;
  html?: string;
  robots?: string;
  latencyMs?: number;
}): TargetProfile {
  const url = new URL(args.url);
  const html = args.html ?? "";
  const headers = args.headers ?? {};
  // The header values matter for detection too: `server: cloudflare`, a `cf-ray`, and a
  // `content-security-policy` that names `challenges.cloudflare.com` are each a signal
  // the body alone does not carry.
  const haystack = `${html}\n${Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}`;

  const domain = registrableDomain(url.hostname);
  const { paths, siblingHosts, externalHosts } = linkScope(html, url.origin, domain);
  const testId = detectTestIdAttr(html);
  const finalUrl = args.finalUrl && args.finalUrl !== args.url ? args.finalUrl : undefined;

  return {
    url: args.url,
    origin: url.origin,
    host: url.host,
    registrableDomain: domain,
    exposure: exposureOf(url.host),
    reachable: args.status !== undefined,
    status: args.status,
    redirectedTo: finalUrl,
    rendering: detectRendering(html),
    consentPlatform: signsIn(haystack, CONSENT_SIGNS)[0],
    consentLikely: signsIn(haystack, CONSENT_SIGNS).length > 0 || exposureOf(url.host) === "public",
    botProtection: signsIn(haystack, BOT_SIGNS),
    testIdAttr: testId?.attr,
    archetype: detectArchetype(html),
    siblingHosts,
    externalHosts,
    sameOriginPaths: paths,
    hasAuthSurface: AUTH_SIGNS.test(html),
    robotsDisallow: args.robots ? parseRobots(args.robots) : [],
    latencyMs: args.latencyMs,
    shellBytes: html.length || undefined,
  };
}

// ---------------------------------------------------------------------------
// The probe itself
// ---------------------------------------------------------------------------

/** Cap on the shell we read. Enough to analyse; not enough to matter to memory. */
const MAX_SHELL_BYTES = 1_500_000;

/**
 * One GET for the shell and one for `robots.txt`, both short-fused.
 *
 * A browser-like `User-Agent` is sent deliberately. The point of the probe is to predict
 * what the *browser* stage will meet, and a default Node fetch signature is served
 * differently — sometimes a challenge page, sometimes a 403 — by exactly the CDNs whose
 * behaviour we are trying to anticipate. Nothing is submitted and no state is changed:
 * this is two GETs.
 */
export async function probeTarget(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<TargetProfile> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const get = async (target: string): Promise<Response | undefined> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch {
      // Unreachable by plain fetch is not unreachable by Chromium. Recorded, not fatal.
      return undefined;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  };

  const startedAt = Date.now();
  const res = await get(url);
  const latencyMs = Date.now() - startedAt;

  let html = "";
  if (res) {
    try {
      const body = await res.text();
      html = body.slice(0, MAX_SHELL_BYTES);
    } catch {
      /* a body we cannot read is a body we analyse as empty */
    }
  }

  let robots: string | undefined;
  try {
    const robotsRes = await get(new URL("/robots.txt", url).toString());
    if (robotsRes?.ok) {
      const body = await robotsRes.text();
      // A SPA that serves index.html for every unknown path answers 200 with markup.
      if (!/<html|<!doctype/i.test(body.slice(0, 200))) robots = body.slice(0, 100_000);
    }
  } catch {
    /* absent robots.txt is the common case and constrains nothing */
  }

  return analyse({
    url,
    finalUrl: res?.url,
    status: res?.status,
    headers: res ? Object.fromEntries(res.headers.entries()) : undefined,
    html,
    robots,
    latencyMs,
  });
}

/**
 * The profile as Decision Log evidence.
 *
 * Only facts that changed a decision are listed. A profile line nobody acted on is noise
 * on the one panel the run is read from, and this report's whole claim is that every
 * number on it was measured and used.
 */
export function profileEvidence(p: TargetProfile): Evidence[] {
  const out: Evidence[] = [
    {
      kind: "http-status",
      summary: p.reachable
        ? `${p.host} answered ${p.status} in ${p.latencyMs}ms` +
          (p.redirectedTo ? `, redirecting to ${p.redirectedTo}` : "")
        : `${p.host} did not answer a plain HTTP GET; the browser stage will try anyway`,
    },
  ];

  if (p.rendering === "client") {
    out.push({
      kind: "heuristic",
      summary: `Client-rendered shell (${p.shellBytes} bytes, almost no text) — an empty first snapshot is expected, not an empty page`,
    });
  }
  if (p.testIdAttr) {
    out.push({
      kind: "selector-provenance",
      summary: `Test hooks use ${p.testIdAttr}` +
        (p.testIdAttr === "data-testid"
          ? " — Playwright's default, so getByTestId resolves as written"
          : ` — Playwright's getByTestId would resolve nothing without configuring testIdAttribute`),
    });
  }
  if (p.consentPlatform) {
    out.push({ kind: "heuristic", summary: `${p.consentPlatform} consent gate stands in front of the content` });
  }
  if (p.botProtection.length) {
    out.push({ kind: "heuristic", summary: `Bot mitigation present: ${p.botProtection.join(", ")}` });
  }
  if (p.externalHosts.length) {
    out.push({
      kind: "heuristic",
      summary:
        `${p.externalHosts.length} third-party host(s) linked from the landing page; the crawl is scoped to ` +
        `${p.registrableDomain}` +
        (p.siblingHosts.length ? ` and its ${p.siblingHosts.length} own subdomain(s)` : ""),
    });
  }
  if (p.archetype !== "unknown") {
    out.push({ kind: "heuristic", summary: `Archetype reads as ${p.archetype} from the landing page` });
  }
  return out;
}
