/**
 * What an untested surface is worth worrying about, computed before any model reads it.
 *
 * The brief asks for "untested flow risk" and §3.5 names the factors: auth-gated,
 * destructive, payment/PII-touching, reachable in a click or two, mentioned in the PRD.
 * Every one of those is a fact about a path and a document, so every one of them is
 * decided here, by rules, with a fixed weight and a sentence explaining itself.
 *
 * This is the same two-layer shape as the defect classifier (`failure-signals.ts`), for
 * the same reason. A model asked "how risky is it that you did not test /forgot-password?"
 * will produce a number and a paragraph, and neither is checkable. A model handed
 * *"88, because it touches credentials (+22), it is one segment from the landing page
 * (+12), the PRD names it (+18), and a scenario for it was quarantined (+15)"* is being
 * asked a much narrower question: is there something here the rules could not see?
 *
 * The weights below are the product's opinion and they are meant to be arguable — which
 * is the point. A number you can argue with is a number that means something. They are
 * pinned by `risk-signals.test.mts` so a quiet edit cannot re-rank a report.
 *
 * Deliberately dependency-free so that test can load the real thing.
 */

import type { Gap, Priority } from "@/lib/types";
import { labelOf, normalise, type SurfaceStatus } from "./coverage-map.ts";

export type RiskFactorId =
  | "credentials"
  | "payments-pii"
  | "destructive"
  | "prd-named"
  | "shallow"
  | "session-gated"
  | "quarantined"
  | "named-in-gap";

export interface RiskFactor {
  id: RiskFactorId;
  weight: number;
  /** The sentence the report prints. Written here so nothing has to narrate it later. */
  reason: string;
}

export interface RiskPrior {
  surface: string;
  score: number;
  band: Priority;
  factors: RiskFactor[];
}

export interface RiskFacts {
  surface: string;
  status: SurfaceStatus;
  /** Whether Recon held a session while it crawled. */
  authenticated: boolean;
  /** The PRD's full text, when the run was given one. */
  prd?: string;
  /** Critic gaps the run never closed. */
  gaps: Gap[];
  /** Set when the surface is `planned-only` because generation quarantined it. */
  quarantineReason?: string;
}

/**
 * The weights. Ordered by what they cost you when the untested thing turns out to be
 * broken, not by how likely it is to break.
 *
 * `quarantined` sits level with `destructive` deliberately: a surface the plan
 * explicitly wanted to cover and could not is worse news than one nobody thought of,
 * because the team has already decided it matters and the run has already failed to get
 * evidence about it.
 */
export const WEIGHT: Record<RiskFactorId, number> = {
  credentials: 22,
  "payments-pii": 20,
  destructive: 18,
  "prd-named": 18,
  quarantined: 18,
  shallow: 12,
  "named-in-gap": 10,
  "session-gated": 8,
};

/**
 * Bands, calibrated against the case §3.5 uses to describe this ledger:
 *
 *   "Password reset — HIGH risk, untested: reachable from login, touches credentials,
 *    named in PRD §4."
 *
 * That is credentials + shallow + prd-named = 52, and it has to come out `high`. The
 * thresholds exist to make the archetype land where the product says it lands, rather
 * than being round numbers picked first and lived with afterwards. The same surface with
 * a quarantined scenario behind it reaches 70 and tips to `critical`, which is the right
 * order: the plan wanted it, the run could not get it, and nobody has looked since.
 *
 * A surface can legitimately score 0 — a deep documentation page fires nothing — and it
 * is reported as `low` rather than inflated to look worth a row.
 */
const BANDS: [number, Priority][] = [
  [70, "critical"],
  [45, "high"],
  [22, "medium"],
  [0, "low"],
];

const CREDENTIAL = /(^|[/\-_])(login|log-in|signin|sign-in|signup|sign-up|register|password|passwd|forgot|reset|recover|auth|oauth|sso|mfa|2fa|otp|verify|session|token|credential|security)([/\-_]|$)/i;
// `pricing` and `plans` are deliberately absent: a marketing page that quotes a price
// handles no money and holds no personal data, and putting them here would float every
// brochure route into the middle of the ledger where the real ones need to be.
const PAYMENT_PII = /(^|[/\-_])(checkout|cart|basket|pay|payment|payments|billing|invoice|card|subscribe|subscription|order|orders|refund|profile|account|address|addresses|personal|kyc|ssn|passport)([/\-_]|$)/i;
const DESTRUCTIVE = /(^|[/\-_])(delete|remove|destroy|cancel|deactivate|disable|archive|purge|close|revoke|terminate|admin|danger)([/\-_]|$)/i;

/** Routes that are the way *in*, so calling them "behind a session" would be wrong. */
const PUBLIC_ENTRY = /(^\/$)|(^\/(login|signin|sign-in|register|signup|sign-up|home|index)([/\-_]|$))/i;

export function scoreSurface(facts: RiskFacts): RiskPrior {
  const path = normalise(facts.surface);
  const label = labelOf(path);
  const factors: RiskFactor[] = [];

  const add = (id: RiskFactorId, reason: string) =>
    factors.push({ id, weight: WEIGHT[id], reason });

  if (CREDENTIAL.test(path)) {
    add("credentials", "Touches credentials, sessions or account recovery");
  }
  if (PAYMENT_PII.test(path)) {
    add("payments-pii", "Handles money or personal data");
  }
  if (DESTRUCTIVE.test(path)) {
    add("destructive", "Exposes a destructive or privileged action");
  }

  if (facts.prd && mentionedInPrd(facts.prd, path, label)) {
    add("prd-named", "Named in the product requirements supplied with this run");
  }

  const depth = path.split("/").filter(Boolean).length;
  if (path !== "/" && depth <= 2) {
    add(
      "shallow",
      `Reachable in ${depth} path segment${depth === 1 ? "" : "s"} from the landing page, so a user finds it without trying`,
    );
  }

  if (facts.authenticated && !PUBLIC_ENTRY.test(path)) {
    add("session-gated", "Behind the session Recon signed in with, so it ships to real users only");
  }

  if (facts.status === "planned-only") {
    add(
      "quarantined",
      facts.quarantineReason
        ? `The plan covers it and no test ran: ${facts.quarantineReason}`
        : "The plan covers it and no test ran, so the intent exists and the evidence does not",
    );
  }

  const gap = facts.gaps.find((g) => mentionsSurface(`${g.title} ${g.rationale}`, path, label));
  if (gap) {
    add("named-in-gap", `An unclosed coverage gap names it: "${gap.title}"`);
  }

  const score = Math.min(100, factors.reduce((n, f) => n + f.weight, 0));
  return { surface: path, score, band: bandOf(score), factors };
}

export function bandOf(score: number): Priority {
  for (const [floor, band] of BANDS) if (score >= floor) return band;
  return "low";
}

/**
 * Whether the PRD names this surface.
 *
 * The path is matched literally — a PRD that says "/forgot-password" means it. The label
 * is matched as a whole word and only when it is long enough to be a word: "orders" in a
 * PRD is a reference to the orders page, "id" is not.
 */
export function mentionedInPrd(prd: string, path: string, label: string): boolean {
  if (path !== "/" && new RegExp(`${escape(path)}\\b`, "i").test(prd)) return true;
  if (label.length < 4) return false;
  return new RegExp(`\\b${escape(label)}\\b`, "i").test(prd);
}

function mentionsSurface(text: string, path: string, label: string): boolean {
  if (path !== "/" && new RegExp(`${escape(path)}\\b`, "i").test(text)) return true;
  return label.length >= 4 && new RegExp(`\\b${escape(label)}\\b`, "i").test(text);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
