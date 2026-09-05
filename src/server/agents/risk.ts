/**
 * The Risk Ledger — what the run did *not* test, and what that is worth worrying about.
 *
 * This closes the last clause of the brief's final-report requirement ("...and untested
 * flow risk"), and §3.5 predicted correctly that it is the item most likely to be
 * skipped or faked. Faking it is easy: hand a model the route list and the plan and ask
 * which gaps are dangerous. The answer is fluent, plausible and unfalsifiable.
 *
 * So the ledger is assembled in the same two layers as the defect classifier, and the
 * seam between them is again the point.
 *
 *   1. **The prior** (`coverage-map.ts` + `risk-signals.ts`). Which surfaces have no
 *      evidence behind them is *computed* from the emitted test source and the run's own
 *      results. What each one is worth is *computed* from the path, the PRD text and the
 *      unclosed critic gaps, with fixed weights and a written reason per factor. This
 *      layer costs nothing, reproduces exactly, and is right most of the time on its own.
 *
 *   2. **The model**, which is asked a much narrower question than "how risky is this?":
 *      given these facts and these numbers, is there something here the rules could not
 *      see? It may move a score, and it may name a surface that is not a route at all —
 *      a modal, a payment iframe, an email flow — from Recon's prose observations.
 *
 * Both of those powers are gated, because both are how this becomes fiction:
 *
 *   - **An adjustment that cites nothing is discarded**, not merely damped. There is no
 *     browser in this stage and so nothing new to have seen; a model that wants to move
 *     a number away from the arithmetic has to say which observation the arithmetic
 *     missed. The deterministic score stands, and the report says the adjustment was
 *     dropped rather than quietly keeping it.
 *   - **An added surface must cite a Recon observation by index**, and the citation is
 *     checked against the array. A surface nothing observed is a surface that may not
 *     exist, and an invented HIGH-risk row is worse than a missing one.
 *
 * The whole stage is one model call over the whole ledger rather than one per surface:
 * ranking is comparative, and a model that sees the other rows ranks better than one
 * scoring in isolation.
 */

import { readFile } from "node:fs/promises";
import { runPath } from "../paths";
import { writeArtifact } from "../workspace";
import { runStructured } from "./harness";
import { models } from "./models";
import { mapCoverage } from "./coverage-map";
import { bandOf, scoreSurface, type RiskPrior } from "./risk-signals";
import { riskSchema } from "./schemas";
import { idsFor } from "@/lib/report-join";
import type { AgentContext } from "../orchestrator/agents";
import type { ReconResult } from "../orchestrator/agents";
import type {
  Evidence,
  Gap,
  GeneratedTest,
  RiskItem,
  Scenario,
  SurfaceCoverage,
  TestResult,
} from "@/lib/types";

/** How far the model may move a computed score, in either direction. */
const MAX_ADJUSTMENT = 15;

const INSTRUCTIONS = `You are the Risk Ledger in an autonomous end-to-end test pipeline.

The run is over. You are given every surface the Recon crawl found, which of them the
generated suite actually exercised, and — for the ones it did not — a risk score that has
already been computed from fixed rules, with the factors that produced it spelled out.

Your job is NOT to re-score from scratch. The arithmetic is reproducible and it is
usually right. Your job is to catch what rules over a URL path cannot see.

You may do two things.

1. ADJUST a computed score, by at most ${MAX_ADJUSTMENT} points either way. Do this only when you can
   name the thing the factors missed — an observation in the Recon list that makes a
   surface more dangerous than its path suggests, or a path whose words look alarming and
   whose page is inert. Put that in "justification", and name it concretely.
   An adjustment with an empty or hand-waving justification will be DISCARDED and the
   computed score kept, so an adjustment you cannot justify costs you the change.

2. ADD a surface that is not a route. Real risk hides in things that have no URL: a
   confirmation modal, a cross-origin payment iframe, an outbound email step, a
   destructive control inside a page that was otherwise covered. Every added surface must
   set "observation" to the INDEX of the Recon observation it comes from. An added
   surface with no observation behind it will be dropped — you are reporting what was
   seen, not what such an application usually has.

Write "headline" as one sentence for the engineer who reads this report: the single most
important thing this run did not find out about their application. Name the surface.

For every surface you keep or add, the "reasons" you write are shown to a human beside
the computed factors. Do not restate the factors — they are already printed. Add only
what you know that they do not.`;

export async function assessRisk(
  ctx: AgentContext,
  req: {
    recon: ReconResult;
    scenarios: Scenario[];
    quarantined: { scenarioId: string; reason: string }[];
    results: TestResult[];
    tests: GeneratedTest[];
  },
): Promise<RiskItem[]> {
  const { surfaces, priors, gaps } = await computeLedger(ctx, req);

  if (!priors.length) {
    ctx.think(
      "orchestrator",
      `Every one of the ${surfaces.length} surface(s) Recon found was exercised by a test that ran. ` +
        "There is nothing for the risk ledger to rank.",
    );
    return [];
  }

  if (ctx.overBudget()) {
    ctx.tool(
      "orchestrator",
      "risk_ledger",
      `Budget spent — publishing the ${priors.length} computed risk scores without a model pass.`,
      false,
    );
    return priors.map((p) => fromPrior(p, surfaceOf(surfaces, p.surface)));
  }

  const out = await runStructured(ctx, {
    as: "orchestrator",
    name: "Risk Ledger",
    tier: models.risk,
    instructions: INSTRUCTIONS,
    input: buildInput(req.recon, surfaces, priors, gaps, ctx.input.prd?.filename),
    outputType: riskSchema,
    maxTurns: 4,
  });

  const items = merge(ctx, priors, surfaces, out, req.recon.evidence);
  await writeArtifact(ctx.runId, "risk.json", JSON.stringify(items, null, 2));
  ctx.artifact("plan", "risk.json", `Risk ledger — ${items.length} untested surfaces, ranked`);
  if (out.headline.trim()) ctx.think("orchestrator", out.headline.trim());
  return items;
}

// ---------------------------------------------------------------------------
// Layer 1 — the arithmetic
// ---------------------------------------------------------------------------

/**
 * The arithmetic, on its own.
 *
 * Exported because it needs no model, no key and no network — which means the offline
 * stub path can compute a *real* risk ledger rather than emitting a written-out one. A
 * fixture ledger is exactly the kind of plausible number this repo keeps finding and
 * deleting, and there is no reason to keep one when the honest version is free.
 */
export async function computeLedger(
  ctx: AgentContext,
  req: {
    recon: ReconResult;
    scenarios: Scenario[];
    quarantined: { scenarioId: string; reason: string }[];
    results: TestResult[];
    tests: GeneratedTest[];
  },
) {
  const sources = await readSources(ctx.runId, req.tests);

  // A scenario counts as executed only if a result under one of its ids says so. The
  // `idsFor` tolerance is here rather than in `coverage-map.ts` so that module can stay
  // loadable by its own test; this is the one place that has to know both conventions.
  const executedIds = new Set(
    req.results
      .filter((r) => r.status !== "quarantined" && r.status !== "pending")
      .map((r) => r.testId),
  );
  const executed = req.scenarios
    .map((s) => s.id)
    .filter((id) => idsFor(id).some((key) => executedIds.has(key)));

  const surfaces = mapCoverage({
    routes: req.recon.routes,
    scenarios: req.scenarios,
    sources,
    executed,
  });

  const gaps = await readUnclosedGaps(ctx.runId);
  // Carried from the Generator's own result, not re-read from `selector-provenance.json`.
  // The orchestrator is holding this text already, and the provenance file is written only
  // by the *real* Generator — so reading it back made the stub path silently lose every
  // quarantine reason while looking like it had them.
  const quarantineReasons = Object.fromEntries(
    req.quarantined.map((q) => [q.scenarioId, q.reason]),
  );

  const priors = surfaces
    .filter((s) => s.status !== "exercised")
    .map((s) =>
      scoreSurface({
        surface: s.surface,
        status: s.status,
        authenticated: req.recon.authenticated,
        prd: ctx.input.prd?.text,
        gaps,
        quarantineReason: s.scenarios.map((id) => quarantineReasons[id]).find(Boolean),
      }),
    )
    // A surface where not one factor fires is not a risk finding — it is a page. Listing
    // it would print a confident 0 beside an empty list of reasons, which is the shape of
    // exactly the fabrication this ledger exists to avoid. Every discovered surface is
    // still in the coverage working table with its state; this list is the ranked ones.
    .filter((p) => p.factors.length > 0)
    .sort((a, b) => b.score - a.score);

  // The whole computation, written before any model is asked anything. If the stage is
  // over budget, the call fails, or `assessRisk` is stubbed entirely, this file — and
  // the report's coverage working — still stand on the arithmetic, which is the layer
  // that never needed a model in the first place.
  await writeArtifact(
    ctx.runId,
    "coverage.json",
    JSON.stringify({ surfaces, priors }, null, 2),
  );

  return { surfaces, priors, gaps };
}

/**
 * The emitted spec source per scenario, so coverage is read off the suite itself.
 *
 * Keyed from `GeneratedTest.file` — the path the Generator actually wrote — rather than
 * rebuilt from the scenario id. Rebuilding it worked for the real Generator's flat
 * `tests/<slug>.spec.ts` and silently missed every nested path, which cost the whole
 * navigation signal without erroring: the ledger simply reported every surface as
 * untested and looked entirely normal doing it. That is the third time in this repo a
 * key has been reconstructed instead of carried, so it is now carried.
 */
async function readSources(
  runId: string,
  tests: GeneratedTest[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const test of tests) {
    try {
      out[test.scenarioId] = await readFile(runPath(runId, test.file), "utf8");
    } catch {
      /* the file is gone; the scenario-text signal still covers this scenario */
    }
  }
  return out;
}

/** For artifact ids only — never for finding a file. */
const slug = (id: string) =>
  id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario";

async function readUnclosedGaps(runId: string): Promise<Gap[]> {
  const critique = await readJson<{ gaps?: Gap[] }>(runId, "critique.json");
  return (critique?.gaps ?? []).filter((g) => !g.resolved);
}

async function readJson<T>(runId: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(runPath(runId, file), "utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — the model, and the gates on it
// ---------------------------------------------------------------------------

function buildInput(
  recon: ReconResult,
  surfaces: SurfaceCoverage[],
  priors: RiskPrior[],
  gaps: Gap[],
  prdName: string | undefined,
): string {
  const exercised = surfaces.filter((s) => s.status === "exercised");
  return [
    `Target had ${surfaces.length} discovered surface(s). ${exercised.length} were exercised by a test that ran.`,
    prdName ? `A PRD was supplied (${prdName}) and the "prd-named" factor has already been applied against its text.` : "No PRD was supplied.",
    "",
    "Recon observations — cite these BY INDEX when adding a surface:",
    ...recon.evidence.map((e, i) => `[${i}] ${e.summary}${e.detail ? ` — ${e.detail}` : ""}`),
    "",
    "Surfaces WITH evidence (do not list these):",
    ...exercised.map((s) => `- ${s.surface} — ${s.basis ?? "exercised"}`),
    "",
    "Surfaces WITHOUT evidence, already scored. Adjust only what the factors missed:",
    ...priors.map((p) => {
      const cov = surfaceOf(surfaces, p.surface);
      return [
        `- ${p.surface} — computed ${p.score}/100 (${p.band}), status ${cov?.status ?? "untested"}`,
        ...p.factors.map((f) => `    +${f.weight} ${f.id}: ${f.reason}`),
        cov?.basis ? `    context: ${cov.basis}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }),
    "",
    gaps.length
      ? `Coverage gaps the run never closed: ${gaps.map((g) => g.title).join("; ")}`
      : "The critic left no unclosed gaps.",
  ].join("\n");
}

type RiskOutput = {
  headline: string;
  adjustments: { surface: string; adjust: number; justification: string; reasons: string[] }[];
  added: { surface: string; observation: number; score: number; reasons: string[] }[];
};

function merge(
  ctx: AgentContext,
  priors: RiskPrior[],
  surfaces: SurfaceCoverage[],
  out: RiskOutput,
  observations: Evidence[],
): RiskItem[] {
  const bySurface = new Map(out.adjustments.map((a) => [a.surface, a]));
  let discarded = 0;

  const items = priors.map((prior) => {
    const item = fromPrior(prior, surfaceOf(surfaces, prior.surface));
    const proposed = bySurface.get(prior.surface);
    if (!proposed || proposed.adjust === 0) return item;

    // The gate. No browser ran in this stage, so an adjustment is only ever a reading of
    // the facts already on the page — and a reading that names nothing is not one.
    const cited = proposed.justification.trim();
    if (cited.length < 25) {
      discarded++;
      ctx.tool(
        "orchestrator",
        "risk_adjustment",
        `Discarded a ${signed(proposed.adjust)} adjustment to ${prior.surface}: no justification given, so the computed ${prior.score} stands.`,
        false,
      );
      return item;
    }

    const delta = clamp(proposed.adjust, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
    const score = clamp(prior.score + delta, 0, 100);
    return {
      ...item,
      score,
      risk: bandOf(score),
      priorScore: prior.score,
      reasons: [
        ...item.reasons,
        `${signed(delta)} on review: ${cited}`,
        ...proposed.reasons.map(clean).filter(Boolean),
      ],
    };
  });

  // Added surfaces, each held to the same standard the Generator holds a locator to:
  // it must trace to something the run actually observed.
  for (const add of out.added) {
    const observed = observations[add.observation];
    if (!observed) {
      ctx.tool(
        "orchestrator",
        "risk_surface",
        `Dropped the added surface "${clean(add.surface)}" — it cites observation ${add.observation}, which is not in Recon's list.`,
        false,
      );
      continue;
    }
    const score = clamp(Math.round(add.score), 0, 100);
    items.push({
      id: `risk-added-${slug(add.surface)}`,
      surface: clean(add.surface),
      risk: bandOf(score),
      score,
      status: "untested",
      reasons: [
        `Not a route — found in Recon's observations: "${observed.summary}"`,
        ...add.reasons.map(clean).filter(Boolean),
      ],
    });
  }

  if (discarded) {
    ctx.think(
      "orchestrator",
      `${discarded} proposed risk adjustment(s) cited nothing the computed factors had missed, so the ` +
        "arithmetic stands for those surfaces. The scores in this ledger are the rules' unless the report says otherwise.",
    );
  }

  return items.sort((a, b) => b.score - a.score);
}

export function fromPrior(prior: RiskPrior, coverage: SurfaceCoverage | undefined): RiskItem {
  return {
    id: `risk-${slug(prior.surface)}`,
    surface: prior.surface,
    risk: prior.band,
    score: prior.score,
    status: coverage?.status === "planned-only" ? "planned-only" : "untested",
    reasons: prior.factors.map((f) => f.reason),
  };
}

export const surfaceOf = (surfaces: SurfaceCoverage[], path: string) =>
  surfaces.find((s) => s.surface === path);

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clean = (s: string) => s.trim().slice(0, 400);
