/**
 * The orchestrator — an explicit finite state machine over one run.
 *
 *   INIT → RECON → PLAN → CRITIQUE ─┬─(gaps, budget left)→ PLAN
 *                                    └─(pass)→ GENERATE
 *   GENERATE → EXECUTE → TRIAGE ─┬─(SCRIPT_DRIFT)→ HEAL
 *                                 ├─(ENV_FLAKE)→ RETRY
 *                                 ├─(APP_DEFECT)→ BUG LEDGER  (never heal)
 *                                 └─(PLAN_ERROR)→ BACKLOG
 *   HEAL → REPORT → DONE
 *
 * Every judgment lives here, not in an agent: whether the plan is good enough, whether
 * a failure is the app's fault, whether a patch is honest, when to stop spending. Each
 * one emits a `decision` event carrying its rationale, confidence and cited evidence —
 * that stream *is* the product, so nothing may branch silently.
 *
 * Agents are injected (see ./agents.ts). Phase 2 runs against deterministic stubs.
 */

import { readFile } from "node:fs/promises";
import { checkAssertionIntegrity } from "./assertion-guard";
import { unifiedDiff } from "./patch";
import { afterGeneration } from "./regenerate";
import { stubAgents } from "./stub-agents";
import type { AgentContext, Agents, ReconResult } from "./agents";
import { headed } from "../browser-mode";
import { runDir, runPath } from "../paths";
import { reportMarkdown } from "../report-markdown";
import { writeArtifact } from "../workspace";
import {
  type Critique,
  type Evidence,
  type FiledBug,
  type HealAttempt,
  type OrchestratorEventInit,
  type RunInput,
  type RunStatus,
  type Scenario,
  type Stage,
  type SurfaceCoverage,
  type TestQualityReport,
  type TestResult,
  type TriageOutcome,
} from "@/lib/types";

/** A critique that never scored anything. Used when an unbuildable plan is sent back. */
const EMPTY_DIMENSIONS = {
  "flow-completeness": 0,
  "negative-paths": 0,
  "error-states": 0,
  "edge-cases": 0,
  "state-variants": 0,
  destructive: 0,
} as const;

export interface OrchestratorOptions {
  runId: string;
  input: RunInput;
  emit: (event: OrchestratorEventInit) => void;
  signal: AbortSignal;
  agents?: Agents;
}

/**
 * The coverage map the risk ledger computed, if it computed one.
 *
 * Absent whenever `assessRisk` is stubbed, which is a real configuration and not an
 * error — so a missing file means the report omits the working, never that it fabricates
 * a denominator for the coverage numbers printed above it.
 */
async function readCoverage(runId: string): Promise<SurfaceCoverage[] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(runPath(runId, "coverage.json"), "utf8")) as {
      surfaces?: SurfaceCoverage[];
    };
    return parsed.surfaces?.length ? parsed.surfaces : undefined;
  } catch {
    return undefined;
  }
}

export async function runOrchestrator(opts: OrchestratorOptions): Promise<RunStatus> {
  const { runId, input, emit, signal } = opts;
  const agents = opts.agents ?? stubAgents;
  const startedAt = new Date();

  let costUsd = 0;
  let budgetExceeded = false;

  const ctx: AgentContext = {
    runId,
    input,
    workspace: runDir(runId),
    signal,
    think: (agent, text) => emit({ type: "agent.thinking", agent, text }),
    tool: (agent, tool, summary, ok = true) =>
      emit({ type: "agent.tool", agent, tool, summary, ok }),
    artifact: (kind, path, title) => emit({ type: "artifact", kind, path, title }),
    overBudget: () => budgetExceeded,
    spend: (usd, tokensIn, tokensOut) => {
      costUsd += usd;
      emit({ type: "cost", usd, tokensIn, tokensOut });
      if (!budgetExceeded && costUsd > input.options.budgetUsd) {
        budgetExceeded = true;
        decide(
          "report",
          "Stop early — the run has reached its budget ceiling",
          `Spend has passed the $${input.options.budgetUsd.toFixed(2)} ceiling set for this run. ` +
            "Continuing would trade an unbounded amount of money for a marginal amount of coverage, " +
            "so the orchestrator degrades gracefully and reports what it has rather than pressing on.",
          [{ kind: "heuristic", summary: `Spend $${costUsd.toFixed(2)} of $${input.options.budgetUsd.toFixed(2)}` }],
        );
      }
    },
  };

  /**
   * A judgment, with its reasoning and the facts behind it.
   *
   * `confidence` is deliberately last and optional. Pass it only when something computed
   * it; a plausible-looking literal on the panel the demo is judged on is worse than no
   * number at all, and eleven of the twelve decisions here used to carry one.
   */
  const decide = (
    stage: Stage,
    action: string,
    rationale: string,
    evidence: Evidence[],
    confidence?: number,
  ) => emit({ type: "decision", stage, action, rationale, confidence, evidence });

  /** Wraps a stage so entry, exit, duration and failure handling are never forgotten. */
  async function stage<T>(
    name: Stage,
    attempt: number,
    body: () => Promise<{ value: T; outcome?: "ok" | "replan" }>,
  ): Promise<T> {
    const t0 = Date.now();
    emit({ type: "stage.entered", stage: name, attempt });
    try {
      const { value, outcome = "ok" } = await body();
      emit({ type: "stage.exited", stage: name, outcome, durationMs: Date.now() - t0 });
      return value;
    } catch (err) {
      if (signal.aborted) throw err;
      emit({
        type: "error",
        stage: name,
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      emit({ type: "stage.exited", stage: name, outcome: "failed", durationMs: Date.now() - t0 });
      throw err;
    }
  }

  emit({ type: "run.started", runId, input });

  // ---- RECON ---------------------------------------------------------------
  const recon = await stage<ReconResult>("recon", 1, async () => {
    const value = await agents.recon(ctx);
    decide(
      "recon",
      "Compact each page to an interactive-element digest instead of raw HTML",
      "Raw DOM would consume roughly 40× the tokens and buries the signal. The accessibility " +
        "tree gives deterministic, nameable targets and keeps the planner inside its context budget.",
      value.evidence.slice(0, 1),
    );
    emit({ type: "recon.ready", routes: value.routes, authenticated: value.authenticated });
    return { value };
  });

  // ---- PLAN ⇄ CRITIQUE ⇄ GENERATE ------------------------------------------
  //
  // Two nested loops, and the outer one is the judgment the brief asks for by name:
  // *when to re-plan*. The inner loop re-plans because the Coverage Critic scored the
  // plan badly. The outer loop re-plans because the plan turned out, on contact with the
  // live application, to be unbuildable — every scenario quarantined, nothing emitted.
  //
  // That distinction was learned from `run_90f1c9f5`, which planned five scenarios the
  // Critic passed at 84/100, watched the Generator quarantine all five, and then ran
  // Execute against an empty suite, Triage against no failures, and published a report
  // about nothing. Every stage behaved correctly and the run was still worthless. A
  // plan that cannot be built is a planning failure, and the run has a re-plan budget
  // for exactly that.
  let scenarios: Scenario[] = [];
  let critique: Critique | null = null;
  let attempt = 1;
  let generationAttempt = 1;
  const critiques: Critique[] = [];
  let generated: Awaited<ReturnType<Agents["generate"]>> = { tests: [], quarantined: [] };

  generation: for (;;) {
    for (;;) {
      scenarios = await stage("plan", attempt, async () => ({
        value: await agents.plan(ctx, {
          attempt,
          directives: critique?.gaps ?? [],
          previous: scenarios.length ? scenarios : undefined,
        }),
      }));
      emit({ type: "plan.ready", attempt, scenarios });

      const verdictAttempt = attempt;
      const graded = await stage("critique", verdictAttempt, async () => {
        const value = await agents.critique(ctx, { attempt: verdictAttempt, scenarios, recon });
        emit({ type: "critique.ready", critique: value });
        return { value, outcome: value.verdict === "replan" ? ("replan" as const) : ("ok" as const) };
      });

      critique = graded;
      critiques.push(graded);

      // The gate. Re-planning is bounded — an unbounded critic loop is a hung demo.
      const budgetLeft = attempt <= input.options.maxReplans && !budgetExceeded;
      if (graded.verdict === "pass") {
        decide(
          "critique",
          `Accept the plan at ${graded.score}/100 and proceed to generation`,
          graded.rationale,
          [
            graded.previousScore
              ? { kind: "heuristic", summary: `Coverage ${graded.previousScore} → ${graded.score} after ${attempt - 1} re-plan` }
              : { kind: "heuristic", summary: `Coverage ${graded.score}/100 on the first pass` },
            { kind: "heuristic", summary: `${graded.gaps.length} gaps accepted as out of budget rather than unnoticed` },
          ],
        );
        break;
      }

      if (!budgetLeft) {
        decide(
          "critique",
          `Proceed at ${graded.score}/100 — the re-plan allowance is spent`,
          `The plan still scores below threshold, but it has been re-planned ${attempt - 1} time(s) and the ` +
            `allowance is ${input.options.maxReplans}. Looping further would spend the run's clock on planning ` +
            "instead of evidence. The unclosed gaps are carried into the risk ledger so nothing is silently dropped.",
          [
            { kind: "heuristic", summary: `Score ${graded.score}/100, ${graded.gaps.length} gaps unresolved` },
            { kind: "heuristic", summary: `maxReplans = ${input.options.maxReplans}` },
          ],
        );
        break;
      }

      decide(
        "critique",
        `Reject the plan and re-plan with ${graded.gaps.length} targeted directives`,
        graded.rationale,
        [
          {
            kind: "heuristic",
            summary: Object.entries(graded.dimensions)
              .filter(([, v]) => v < 60)
              .map(([k, v]) => `${k} ${v}/100`)
              .join(", ") || `overall ${graded.score}/100`,
          },
          ...recon.evidence.slice(1, 2),
        ],
      );
      attempt++;
    }

    // ---- GENERATE ------------------------------------------------------------
    generated = await stage("generate", generationAttempt, async () => {
      const value = await agents.generate(ctx, { scenarios });
      for (const q of value.quarantined) {
        decide(
          "generate",
          `Quarantine "${q.title}" instead of emitting a guessed selector`,
          q.reason,
          // The reason *is* the evidence here: it names the element that could not be
          // resolved, or the locators the provenance check could not account for. A
          // second, generic line restating it added nothing a reader could check.
          [{ kind: "selector-provenance", summary: q.reason }],
        );
      }
      const verified = value.tests.reduce((n, t) => n + t.selectorsVerified, 0);
      const total = value.tests.reduce((n, t) => n + t.selectorsTotal, 0);
      decide(
        "generate",
        value.tests.length
          ? `Ship ${value.tests.length} verified tests; hold ${value.quarantined.length} scenarios in quarantine`
          : `Ship nothing — all ${value.quarantined.length} scenarios failed the provenance check`,
        value.tests.length
          ? "A suite where every selector is proven is worth more than a larger suite with guessed " +
            "locators. Each emitted locator was resolved on the live page by Playwright itself " +
            "during generation; the held scenarios are reported with reasons rather than dropped, " +
            "so the team can unblock them deliberately."
          : "Every scenario either could not be walked to its state or produced code using locators " +
            "the run never resolved. Emitting them would be guessing, so nothing is emitted. This " +
            "is a failed generation, not a small suite, and it is reported as one.",
        [
          {
            kind: "selector-provenance",
            summary: `${verified}/${total} emitted locators resolved on the live page during generation`,
          },
        ],
      );
      return { value, outcome: value.tests.length ? ("ok" as const) : ("replan" as const) };
    });

    // The gate. Its rules are in `./regenerate.ts` so they can be checked without a
    // browser, a model or a key — see `regenerate.test.mts`.
    const verdict = afterGeneration({
      emitted: generated.tests.length,
      quarantined: generated.quarantined,
      attempt,
      maxReplans: input.options.maxReplans,
      overBudget: budgetExceeded,
    });

    if (verdict.action === "proceed") break generation;

    if (verdict.action === "escalate") {
      decide(
        "generate",
        "Escalate — the plan cannot be built and there is no allowance left to re-plan it",
        `All ${generated.quarantined.length} scenario(s) were quarantined, so there is no suite to run. ` +
          (verdict.because === "over-budget"
            ? "The run is over its budget ceiling, so buying another plan is not available. "
            : `The re-plan allowance of ${input.options.maxReplans} is spent. `) +
          "The report that follows is real but carries no execution evidence, and it says so rather " +
          "than reading as a clean run.",
        [
          { kind: "selector-provenance", summary: `${generated.quarantined.length} scenario(s) quarantined, 0 emitted` },
          { kind: "heuristic", summary: `plan attempt ${attempt} of ${input.options.maxReplans + 1}` },
        ],
      );
      break generation;
    }

    decide(
      "generate",
      "Re-plan — the plan passed critique but could not be built against the live application",
      `Every one of the ${generated.quarantined.length} scenario(s) was quarantined, so this plan produced no ` +
        "evidence at all. That is a failure of the plan rather than of the Generator: the scenarios asked for " +
        "states the application does not expose. Re-planning against the specific reasons costs one of this " +
        "run's re-plan allowance and is the only move that can still produce a suite; proceeding would spend " +
        "every remaining stage on an empty suite.",
      [
        { kind: "selector-provenance", summary: `0 of ${generated.quarantined.length} scenarios emitted a test` },
        ...generated.quarantined.slice(0, 2).map((q) => ({
          kind: "selector-provenance" as const,
          summary: `${q.title} — ${q.reason}`,
        })),
      ],
    );

    // Handed back through the channel the Planner already revises against. These are
    // unbuildability directives rather than coverage gaps, and they say so themselves.
    critique = {
      attempt,
      score: critique?.score ?? 0,
      dimensions: critique?.dimensions ?? EMPTY_DIMENSIONS,
      verdict: "replan",
      rationale:
        "The plan scored well and still produced nothing. Every scenario below was quarantined by the " +
        "Generator after it walked the live application, so each one has to be re-scoped to a state the " +
        "application actually exposes — or dropped in favour of one that is reachable.",
      gaps: verdict.directives,
    };
    critiques.push(critique);
    attempt++;
    generationAttempt++;
  }

  const replans = attempt - 1;

  for (const t of generated.tests) emit({ type: "test.generated", test: t });

  // ---- EXECUTE -------------------------------------------------------------
  const results = new Map<string, TestResult>();
  const firstPass = await stage("execute", 1, async () => {
    // Only a real fan-out is worth a decision. This used to announce a sharding
    // rationale unconditionally — including "Shard 0 tests across 4 workers", citing
    // evidence ("no shared mutable state detected") that nothing in the pipeline
    // measures. A Decision Log entry has to correspond to a choice actually made.
    //
    // And the choice is not `parallelWorkers`: a headed run is watched by a person and
    // the generated config pins it to one worker, so on the normal path there is no
    // fan-out to announce at all.
    const workers = headed() ? 1 : Math.min(input.options.parallelWorkers, generated.tests.length);
    if (generated.tests.length > 1 && workers > 1) {
      decide(
        "execute",
        `Shard ${generated.tests.length} tests across ${workers} workers`,
        "Each generated test bootstraps its own session from the same storage state, so the " +
          `suite has no ordering requirement between flows and can be split. ${workers} workers ` +
          "is this run's parallelism setting bounded by the test count, so no worker starts idle.",
        [{ kind: "heuristic", summary: `${generated.tests.length} independent tests, ${workers} workers` }],
      );
    }
    return { value: await agents.execute(ctx, { tests: generated.tests, attempt: 1 }) };
  });

  for (const r of firstPass) {
    results.set(r.testId, r);
    emit({ type: "test.result", result: r });
  }

  // ---- TRIAGE --------------------------------------------------------------
  const failures = firstPass.filter((r) => r.status === "failed");
  let triage: TriageOutcome[] = [];
  const bugs: FiledBug[] = [];

  if (failures.length) {
    triage = await stage("triage", 1, async () => {
      const value = await agents.triage(ctx, { failures });
      for (const outcome of value) emit({ type: "triage.verdict", outcome });

      const defects = value.filter((v) => v.verdict === "APP_DEFECT");
      const drift = value.filter((v) => v.verdict === "SCRIPT_DRIFT");
      const flakes = value.filter((v) => v.verdict === "ENV_FLAKE");

      if (defects.length) {
        decide(
          "triage",
          `Withhold the Healer from ${defects.length} of ${value.length} failures`,
          `${defects.map((d) => d.testId).join(" and ")} are classified as genuine application defects. ` +
            "Healing a real defect deletes the exact signal the suite exists to produce, so these stay red " +
            `and are filed as bugs. ${drift.length} script-drift failure(s) go to the Healer; ` +
            `${flakes.length} suspected flake(s) are retried once before reclassification.`,
          value.flatMap((v) => v.evidence.filter((e) => e.kind === "http-status" || e.kind === "snapshot-diff")).slice(0, 3),
          // The one confidence in the run that is computed rather than chosen: the
          // weakest of the classifier's own per-failure confidences, because the
          // decision is only as sound as the least certain verdict it rests on.
          Math.min(...value.map((v) => v.confidence)),
        );
      }

      // The bug ledger. Filed from the classifier's own evidence — never re-narrated,
      // and never enriched from a fixture: this used to prefer a hand-written record out
      // of `fixtures.ts` whenever a testId happened to match, which meant the orchestrator
      // could file a bug the classifier had not actually found.
      for (const d of defects) {
        const bug: FiledBug = {
          id: `bug-${d.testId}`,
          testId: d.testId,
          // The classifier's own words when it named the defect. Falling back to the
          // test's title is the honest default; inventing a description of a bug that
          // nothing diagnosed would be the orchestrator asserting a finding it does
          // not have.
          title: d.bug?.title ?? `${results.get(d.testId)?.title ?? d.testId} — application defect`,
          severity: d.bug?.severity ?? "high",
          evidence: d.evidence,
        };
        bugs.push(bug);
        emit({ type: "bug.filed", bug });
      }
      return { value };
    });
  }

  // ---- HEAL ----------------------------------------------------------------
  const heals: HealAttempt[] = [];
  const healable = triage.filter((t) => t.verdict === "SCRIPT_DRIFT" || t.verdict === "ENV_FLAKE");

  if (healable.length && !budgetExceeded) {
    await stage("heal", 1, async () => {
      for (const t of healable) {
        let healed = false;

        // A suspected flake is retried before it is patched, because the cheapest way to
        // find out whether anything is actually wrong with a test is to run it again.
        // Patching a test that was only ever slow would bake a workaround into the suite
        // for a problem that does not exist.
        if (t.verdict === "ENV_FLAKE") {
          decide(
            "heal",
            `Retry ${t.testId} before patching anything`,
            "The classifier called this an environment flake, not a defect in the test or the application. " +
              "A retry costs one test run and settles it: if it passes, there was never anything to heal, and " +
              "if it fails the same way twice it was not a flake and the Healer takes it.",
            t.evidence.slice(0, 2),
            t.confidence,
          );
          const retry = await agents.rerun(ctx, { testId: t.testId, attempt: 2, healed: false });
          results.set(retry.testId, retry);
          emit({ type: "test.result", result: retry });
          if (retry.status === "passed" || retry.status === "healed") continue;
        }

        for (let n = 1; n <= input.options.maxHealAttemptsPerTest; n++) {
          const proposal = await agents.proposeHeal(ctx, { testId: t.testId, attempt: n, triage: t });
          if (!proposal) break;

          // The assertion-integrity guard. Locators and waits may change; what the
          // test *proves* may not. This is a syntactic check on purpose — it cannot
          // be argued out of by a persuasive model.
          const guard = checkAssertionIntegrity(proposal.before, proposal.after);

          const record: HealAttempt = {
            testId: t.testId,
            attempt: n,
            summary: guard.intact
              ? proposal.summary
              : `${proposal.summary} — REJECTED by the assertion-integrity guard`,
            before: proposal.before,
            after: proposal.after,
            assertionsIntact: guard.intact,
            // Provisional. A patch that clears the guard has not healed anything yet —
            // only the re-run can say that, and it is set below. This used to be left at
            // "healed" for every accepted patch, so the report counted a patch that was
            // *allowed* as a test that *passed*, which is the one thing the report exists
            // not to do.
            outcome: guard.intact ? "escalated" : "rejected",
          };
          heals.push(record);
          emit({ type: "heal.attempted", attempt: record });

          if (!guard.intact) {
            decide(
              "heal",
              `Reject the Healer's patch for ${t.testId} — it weakened an assertion`,
              "The patch would make the test pass without verifying the behaviour it exists to verify. " +
                "The guard rejects any patch that deletes, loosens, retargets or negates an assertion; " +
                "the Healer may only change locators and waits.",
              guard.violations.map((v) => ({ kind: "assertion-diff" as const, summary: v })),
            );
            continue;
          }

          // Accepted. Applying the patch is the orchestrator's act, not the Healer's:
          // the Healer proposed, the guard cleared it, and this line is where that
          // decision becomes a file the next run of the suite will actually execute.
          // The diff is computed from the before/after that was checked, so the artifact
          // and the file on disk cannot disagree.
          const path = `heal/patch-${t.testId}-${n}.diff`;
          if (proposal.file) {
            await writeArtifact(runId, proposal.file, proposal.after);
            await writeArtifact(runId, path, unifiedDiff(proposal.before, proposal.after, proposal.file));
          }
          ctx.artifact("patch", path, `Healed — ${results.get(t.testId)?.title ?? t.testId}`);

          const rerun = await agents.rerun(ctx, { testId: t.testId, attempt: n + 1, healed: true });
          results.set(rerun.testId, rerun);
          emit({ type: "test.result", result: rerun });
          healed = rerun.status === "healed" || rerun.status === "passed";
          record.outcome = healed ? "healed" : "escalated";
          if (healed) break;
        }

        if (!healed) {
          const attempts = heals.filter((h) => h.testId === t.testId);
          const last = attempts.at(-1);
          if (last) last.outcome = "escalated";
          decide(
            "heal",
            attempts.length
              ? `Escalate ${t.testId} — ${attempts.length} heal attempt(s) did not converge`
              : `Escalate ${t.testId} — the Healer proposed no patch`,
            attempts.length
              ? "Repeated patches failed to make the test pass without weakening it. Escalating with the " +
                "attempt history attached is the honest outcome; a test that only passes because it stopped " +
                "checking anything is worse than a red one."
              : "The Healer declined to patch this test — the element is gone rather than moved, or the only " +
                "available fix would have weakened what the test proves. A decline with a reason is a result: " +
                "the test stays red and the report says why nobody could fix it.",
            [
              {
                kind: "heuristic",
                summary: attempts.length
                  ? `${attempts.length} attempt(s), none converged`
                  : "No patch was proposed",
              },
            ],
          );
        }
      }
      return { value: undefined };
    });
  }

  // ---- REPORT --------------------------------------------------------------
  const report = await stage("report", 1, async () => {
    ctx.think("orchestrator", "Synthesising coverage, outcomes, healer actions, residual gaps and untested-flow risk.");

    // Built before the ledger, because both the risk ledger and the PRD trace turn on
    // exactly one question — did a test that ran stand behind this? — and that question
    // is answered by this array. Passing it in is what stops either stage from having to
    // read a `report.json` that does not exist yet.
    const finalResults: TestResult[] = [
      ...results.values(),
      ...generated.quarantined.map((q, i) => ({
        id: `q-${i}`,
        testId: `q-${q.scenarioId}`,
        title: q.title,
        status: "quarantined" as const,
        durationMs: 0,
        attempt: 0,
        error: q.reason,
      })),
    ];

    const risks = await agents.assessRisk(ctx, {
      recon,
      scenarios,
      quarantined: generated.quarantined.map((q) => ({ scenarioId: q.scenarioId, reason: q.reason })),
      results: finalResults,
      tests: generated.tests,
    });
    const prd = await agents.tracePrd(ctx, { scenarios, results: finalResults });

    // The working behind the ledger, read back from the artifact the stage wrote. Read
    // rather than returned because it is optional by design: a stubbed `assessRisk`
    // writes no coverage map, and the report says nothing about surfaces instead of
    // inventing a denominator for the numbers above it.
    const surfaces = await readCoverage(runId);
    const prdUntraced = prd
      ? scenarios
          .map((s) => s.id)
          .filter((id) => !prd.some((r) => r.coveredBy.includes(id)))
      : undefined;

    // The risk ledger is a judgment about what the run chose not to find out, so it
    // belongs in the Decision Log like every other one. Said only when there is
    // something to say: on a run that covered everything, silence is the honest output.
    const worst = risks[0];
    if (worst) {
      const noEvidence = risks.filter((r) => r.status === "planned-only");
      decide(
        "report",
        `Publish ${risks.length} untested surface(s), led by ${worst.surface} at ${worst.score}/100`,
        `The suite proves things about the surfaces it reached and nothing about the ones it did not, and ` +
          "the second half of that sentence is the half a green report hides. Every surface Recon found is " +
          "scored against fixed factors — credentials, money, destructive actions, reachability, whether the " +
          `PRD names it — so the ranking is arithmetic a reader can check rather than a model's impression. ` +
          (noEvidence.length
            ? `${noEvidence.length} of these are surfaces the plan *does* cover: the scenario existed and no test ever ran, ` +
              "which is intent without evidence and ranks above a surface nobody thought of."
            : "Every one of these is a surface no scenario ever named."),
        [
          { kind: "heuristic", summary: `${worst.surface} — ${worst.risk}: ${worst.reasons[0] ?? "untested"}` },
          {
            kind: "heuristic",
            summary: surfaces
              ? `${surfaces.filter((s) => s.status === "exercised").length}/${surfaces.length} discovered surfaces exercised by a test that ran`
              : `${risks.length} surfaces ranked`,
          },
        ],
      );
    }

    if (prd) {
      const withEvidence = prd.filter((r) => r.covered).length;
      const plannedOnly = prd.filter((r) => r.status === "planned-only").length;
      decide(
        "report",
        `Trace ${prd.length} stated requirement(s) to the suite — ${prd.length - withEvidence} have no test behind them`,
        "Requirements are matched to scenarios by the model and then resolved against what the run actually " +
          "did, which is where the matrix earns its place: a requirement whose scenario was quarantined is " +
          "reported as having no evidence rather than as covered. " +
          (plannedOnly
            ? `${plannedOnly} requirement(s) land exactly there — the plan covers them and no test ran.`
            : "Every mapped requirement had a test that reached the runner."),
        [
          { kind: "prd", summary: `${withEvidence}/${prd.length} requirements proven or exercised by a test that ran` },
          ...(prdUntraced?.length
            ? [{ kind: "prd" as const, summary: `${prdUntraced.length} scenario(s) trace to no stated requirement` }]
            : []),
        ],
      );
    }

    const passed = finalResults.filter((r) => r.status === "passed").length;
    const healedCount = finalResults.filter((r) => r.status === "healed").length;
    const failed = finalResults.filter((r) => r.status === "failed").length;
    const finishedAt = new Date();

    const value: TestQualityReport = {
      runId,
      url: input.url,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      costUsd,
      coverageScore: critique?.score ?? 0,
      scenariosPlanned: scenarios.length,
      scenariosGenerated: generated.tests.length,
      scenariosQuarantined: generated.quarantined.length,
      passed,
      failed,
      healed: healedCount,
      replans,
      healAttempts: heals.length,
      scenarios,
      results: finalResults,
      triage,
      heals,
      bugs,
      remainingGaps: critique?.gaps ?? [],
      risks,
      prd,
      surfaces,
      prdUntraced,
    };

    // "Every executed test is green" is only true when something executed. With an empty
    // suite that sentence was published as a success, which is the single most misleading
    // thing this report could say: zero tests is a pipeline failure wearing a pass.
    const executed = passed + healedCount + failed;

    decide(
      "report",
      executed === 0
        ? "Publish an empty report — the pipeline produced no executable tests"
        : failed
          ? `Publish the suite with ${failed} test(s) left red`
          : "Publish the suite — every executed test is green",
      executed === 0
        ? `The plan reached ${scenarios.length} scenario(s) but none became a running test, so there is no ` +
          "evidence here about whether the application works. This is reported as the failure it is rather " +
          "than as a green run: a report that says nothing went wrong, when nothing ran, is worse than no " +
          "report. The risk ledger below is the entire result."
        : failed
          ? // What the red tests mean is the classifier's call, and saying more than it
            // found would be inventing a verdict. Bugs are named only when triage filed one.
            (bugs.length
              ? `${bugs.length} of them are classified as genuine application defects and are filed as bugs ` +
                "with their evidence attached. Leaving those red is the correct outcome — healing a real " +
                "defect deletes the signal the suite exists to produce. "
              : "They are reported unclassified: no failure was routed to the defect classifier in this run, " +
                "so nothing here claims to know whether the script or the application is at fault. ") +
            "The risk ledger names the surfaces we never reached."
          : "Every generated test passes and every quarantined scenario is reported with a reason. The risk " +
            "ledger names what we did not reach so the green result is not mistaken for total coverage.",
      [
        {
          kind: "heuristic",
          summary: `${passed} passed · ${healedCount} healed · ${failed} failed · ${generated.quarantined.length} quarantined`,
        },
        { kind: "heuristic", summary: `Coverage ${value.coverageScore}/100 after ${replans} re-plan(s)` },
      ],
    );

    await writeArtifact(runId, "report.json", JSON.stringify(value, null, 2));
    ctx.artifact("plan", "report.json", "Test quality report");

    // The same report as a document a person reviews, written beside the suite it
    // describes. `report.json` is what the UI reads; this is what lands in a pull
    // request, and the brief asks for something a team could actually adopt.
    await writeArtifact(runId, "report.md", reportMarkdown(value));
    ctx.artifact("plan", "report.md", "Test quality report (Markdown)");
    return { value };
  });

  // A run that produced no running test did not succeed, whatever the Decision Log says
  // about it. The status field is what the run list, the index and every glance at the
  // home page read, and it used to say `succeeded` for a pipeline that had emitted
  // nothing — the one place the honesty had to hold and the one place it did not.
  const executedAnything =
    report.passed + report.healed + report.failed > 0;
  const status: RunStatus = executedAnything ? "succeeded" : "failed";
  if (!executedAnything) {
    emit({
      type: "error",
      stage: "report",
      message:
        `The run finished without executing a single test: ${scenarios.length} scenario(s) planned, ` +
        `${generated.quarantined.length} quarantined, ${generated.tests.length} generated. The report ` +
        "below is real, but it contains no evidence about the application.",
      recoverable: false,
    });
  }

  emit({ type: "run.finished", status, report });
  return status;
}
