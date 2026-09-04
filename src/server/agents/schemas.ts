/**
 * Structured-output schemas for the three Phase 3 agents.
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

export function toEvidence(items: z.infer<typeof evidenceSchema>[]): Evidence[] {
  return items.map((e) => ({
    kind: e.kind,
    summary: e.summary,
    detail: e.detail ?? undefined,
  }));
}
