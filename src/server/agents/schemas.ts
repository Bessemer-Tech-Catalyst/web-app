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

export function toEvidence(items: z.infer<typeof evidenceSchema>[]): Evidence[] {
  return items.map((e) => ({
    kind: e.kind,
    summary: e.summary,
    detail: e.detail ?? undefined,
  }));
}
