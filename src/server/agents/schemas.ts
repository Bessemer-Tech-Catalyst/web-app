/**
 * Structured-output schemas for every agent that returns one.
 *
 * These mirror the domain types in `@/lib/types` rather than importing them, because a
 * structured-output schema has constraints a TypeScript interface does not: every field
 * must be present, so "optional" is expressed as `.nullable()` and normalised back to
 * `undefined` at the boundary. The normalising functions below are that boundary — the
 * rest of the server only ever sees the domain types.
 *
 * Enums are pinned to the same unions as the domain types on purpose. A model that
 * invents a seventh `ScenarioKind` fails schema validation loudly instead of flowing a
 * bad string into the UI.
 */

import { z } from "zod";
import type { Critique, Evidence, Gap, Scenario } from "@/lib/types";

const priority = z.enum(["critical", "high", "medium", "low"]);
const scenarioKind = z.enum([
  "happy-path",
  "negative",
  "edge-case",
  "error-state",
  "permission",
  "destructive",
]);
const critiqueDimension = z.enum([
  "flow-completeness",
  "negative-paths",
  "error-states",
  "edge-cases",
  "state-variants",
  "destructive",
]);
const evidenceKind = z.enum([
  "snapshot-diff",
  "console-error",
  "network",
  "http-status",
  "selector-provenance",
  "cross-test",
  "screenshot",
  "trace",
  "assertion-diff",
  "prd",
  "heuristic",
]);

const evidenceSchema = z.object({
  kind: evidenceKind,
  summary: z.string(),
  detail: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Recon
// ---------------------------------------------------------------------------

export const reconSchema = z.object({
  routes: z.array(z.string()).describe("Every distinct path reached, e.g. /checkout"),
  authenticated: z
    .boolean()
    .describe("True only if a signed-in session was actually proven, not merely attempted"),
  archetype: z
    .string()
    .describe("The app archetype you inferred, e.g. 'e-commerce storefront'"),
  evidence: z
    .array(evidenceSchema)
    .describe("What you observed that a critic could score a plan against"),
});

export type ReconOutput = z.infer<typeof reconSchema>;

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

const scenarioSchema = z.object({
  id: z.string().describe("Stable slug, e.g. 'checkout-happy-path'"),
  title: z.string(),
  flow: z.string().describe("The user flow this belongs to, e.g. 'Checkout'"),
  kind: scenarioKind,
  priority,
  steps: z.array(z.string()).describe("Numbered user-visible actions, no selectors"),
  expected: z.string().describe("The observable outcome that makes this test pass"),
  addedByCritique: z
    .boolean()
    .describe("True only when this scenario exists to close a critic directive"),
});

export const planSchema = z.object({
  scenarios: z.array(scenarioSchema),
});

export function toScenarios(out: z.infer<typeof planSchema>): Scenario[] {
  return out.scenarios.map((s) => ({
    ...s,
    addedByCritique: s.addedByCritique || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

const gapSchema = z.object({
  id: z.string(),
  title: z.string(),
  dimension: critiqueDimension,
  severity: priority,
  rationale: z.string().describe("Why this gap matters, citing a recon observation"),
});

export const critiqueSchema = z.object({
  score: z.number().min(0).max(100),
  dimensions: z.object({
    "flow-completeness": z.number().min(0).max(100),
    "negative-paths": z.number().min(0).max(100),
    "error-states": z.number().min(0).max(100),
    "edge-cases": z.number().min(0).max(100),
    "state-variants": z.number().min(0).max(100),
    destructive: z.number().min(0).max(100),
  }),
  gaps: z.array(gapSchema),
  verdict: z.enum(["pass", "replan"]),
  rationale: z
    .string()
    .describe("The reasoning the Decision Log will show verbatim — write it for a human"),
});

export function toCritique(
  out: z.infer<typeof critiqueSchema>,
  attempt: number,
  previousScore: number | undefined,
): Critique {
  const gaps: Gap[] = out.gaps.map((g) => ({ ...g }));
  return {
    attempt,
    score: Math.round(out.score),
    previousScore,
    dimensions: out.dimensions,
    gaps,
    verdict: out.verdict,
    rationale: out.rationale,
  };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * One scenario's worth of Generator output.
 *
 * `outcome` is the Generator's *recommendation*, not the decision. The orchestrator
 * quarantines on its own account too, whenever the emitted code turns out to use a
 * locator the run never resolved — see `locator-provenance.ts`. An agent that could
 * declare its own work verified would be judging, and judging is not its job.
 */
export const generatedTestSchema = z.object({
  outcome: z
    .enum(["emit", "quarantine"])
    .describe("emit only if every element the test needs was found on the live page"),
  reason: z
    .string()
    .describe(
      "One or two sentences a person will read. On quarantine, name the element or state you could not reach.",
    ),
  code: z
    .string()
    .nullable()
    .describe("The complete .spec.ts file when emitting; null when quarantining"),
});

export type GeneratedTestOutput = z.infer<typeof generatedTestSchema>;

// ---------------------------------------------------------------------------
// Classifier (triage)
// ---------------------------------------------------------------------------

/**
 * One failure's verdict.
 *
 * `agreesWithPrior` is not decoration. The classifier is handed a rule-based prior
 * computed from the runner's own output and the generation-time locator ledger
 * (`failure-signals.ts`), and overturning it is allowed but must be *declared* — which
 * is what makes "the model disagreed with the rules, and here is what it saw that they
 * could not" a line in the Decision Log rather than a silent swing in the verdict.
 */
export const triageSchema = z.object({
  verdict: z.enum(["SCRIPT_DRIFT", "APP_DEFECT", "ENV_FLAKE", "PLAN_ERROR"]),
  confidence: z.number().min(0).max(1),
  agreesWithPrior: z.boolean(),
  rationale: z
    .string()
    .describe("Two or three sentences for the engineer reading the Decision Log"),
  evidence: z
    .array(evidenceSchema)
    .describe("What you observed live. Never restate the prior's facts as your own."),
  /** Only meaningful on APP_DEFECT — otherwise ignored. */
  bugTitle: z.string().nullable(),
  bugSeverity: z.enum(["critical", "high", "medium", "low"]).nullable(),
});

export type TriageOutput = z.infer<typeof triageSchema>;

// ---------------------------------------------------------------------------
// Healer
// ---------------------------------------------------------------------------

/**
 * A patch proposal — the whole file, not a diff.
 *
 * A model asked for a diff spends its budget getting hunk offsets right and gets them
 * wrong; a whole file is checkable against both gates the orchestrator runs on it (the
 * assertion-integrity guard and the locator-provenance gate), and the diff for the
 * report is computed from before/after here rather than trusted from the model.
 */
export const healSchema = z.object({
  outcome: z
    .enum(["patch", "decline"])
    .describe("decline when the failure is not something a locator or wait can fix"),
  summary: z.string().describe("One line: what changed and why it should now pass"),
  code: z.string().nullable().describe("The complete patched .spec.ts when patching; null when declining"),
});

export type HealOutput = z.infer<typeof healSchema>;

// ---------------------------------------------------------------------------
// Risk ledger
// ---------------------------------------------------------------------------

/**
 * What the model is allowed to contribute to the risk ledger — which is deliberately
 * not "the ledger".
 *
 * The scores arrive already computed (`risk-signals.ts`), so the schema only carries the
 * two things a model can add that rules over a URL path cannot: a bounded correction
 * with its justification, and a surface that has no URL at all. Both are gated in
 * `risk.ts` — an unjustified adjustment is discarded and an uncited surface is dropped —
 * and the shape here is what makes those gates checkable rather than a matter of tone.
 */
export const riskSchema = z.object({
  headline: z
    .string()
    .describe("One sentence: the most important thing this run did not find out. Name the surface."),
  adjustments: z.array(
    z.object({
      surface: z.string().describe("Exactly as it appears in the scored list"),
      adjust: z
        .number()
        .describe("Points to add or subtract, at most 15 either way. 0 to leave it alone."),
      justification: z
        .string()
        .describe("What the computed factors missed. An empty or vague one discards the adjustment."),
      reasons: z.array(z.string()).describe("Extra lines for the report. Never restate a factor."),
    }),
  ),
  added: z.array(
    z.object({
      surface: z.string().describe("A risk with no URL — a modal, an iframe, an email step"),
      observation: z
        .number()
        .int()
        .describe("Index into the Recon observation list this came from. Checked; a miss drops the row."),
      score: z.number().min(0).max(100),
      reasons: z.array(z.string()),
    }),
  ),
});

// ---------------------------------------------------------------------------
// PRD traceability
// ---------------------------------------------------------------------------

/**
 * The mapping, and only the mapping.
 *
 * Note what the model is *not* asked for: whether a requirement is covered. That is
 * resolved after it, in `prd-gate.ts`, from the run's own results — because a scenario
 * the Generator quarantined is a plan, not a test, and only the run knows which
 * scenarios became evidence. Asking the model for a `covered` boolean here is how the
 * naive version of this feature ticks a requirement nothing ever loaded.
 */
export const prdSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string().describe("The document's own identifier where it has one, else R1, R2, …"),
      text: z.string().describe("The requirement as a single testable statement"),
      quote: z
        .string()
        .describe("VERBATIM from the document — a reader checks your extraction with this string"),
      coveredBy: z
        .array(z.string())
        .describe("Scenario ids from the supplied plan that would prove it. Empty is a valid, valuable answer."),
    }),
  ),
});

export function toEvidence(items: z.infer<typeof evidenceSchema>[]): Evidence[] {
  return items.map((e) => ({
    kind: e.kind,
    summary: e.summary,
    detail: e.detail ?? undefined,
  }));
}
