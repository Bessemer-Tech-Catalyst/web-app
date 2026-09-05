/**
 * The Classifier — is the test broken, or is the application broken?
 *
 * This is the brief's Bonus item and the one most teams will fudge, because the fudge is
 * invisible: hand a model an error string, ask the question, and it will answer in
 * fluent prose either way with nothing behind it. So the classification here is built in
 * two layers, and the layers are kept apart on purpose.
 *
 *   1. **A prior, computed by rules** (`failure-signals.ts`) out of Playwright's own
 *      error text and the generation-time locator ledger. It is reproducible, it costs
 *      nothing, and it is right most of the time on its own — "the element was found and
 *      held the wrong value" and "the element was never found" are different verdicts and
 *      the runner already told us which happened.
 *   2. **A live look at the application**, with a read-only browser. The classifier
 *      navigates to where the test died and asks the two questions the error text cannot
 *      answer: did the server return a 5xx, and did the page throw? Either one turns a
 *      "the locator moved" story into "the feature is broken".
 *
 * The model may overturn the prior. It may not do so quietly: `agreesWithPrior` is part
 * of its output, a disagreement is published as its own decision, and its confidence is
 * damped when it overrules the rules without citing anything the rules could not see.
 *
 * The browser is read-only by allowlist (`CLASSIFIER_TOOLS`). A classifier that can
 * click is a classifier that can change the state it is reporting on.
 */

import { readFile } from "node:fs/promises";
import { runPath } from "../paths";
import { writeArtifact } from "../workspace";
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { triageSchema, toEvidence, type TriageOutput } from "./schemas";
import { prove } from "./locator-provenance";
import { readFullError } from "./executor";
import {
  correlate,
  priorEvidence,
  priorVerdict,
  readSignals,
  type FailureSignals,
  type Prior,
} from "./failure-signals";
import type { AgentContext } from "../orchestrator/agents";
import type { Evidence, TestResult, TriageOutcome } from "@/lib/types";

/** Short by design: this is one page, two tool calls and a judgment, not an expedition. */
const MAX_TURNS_PER_FAILURE = 20;

const INSTRUCTIONS = `You are the Defect Classifier in an autonomous end-to-end test pipeline.

One generated test failed. You decide which of four things happened, and the pipeline
acts on your answer without asking anyone:

- SCRIPT_DRIFT — the application is healthy; the test's locator or wait is wrong. The
  Healer will rewrite the test.
- APP_DEFECT — the application is genuinely broken. The test STAYS RED and a bug is
  filed. Nothing patches it. Getting this wrong in the other direction is the cardinal
  sin here: healing a real defect deletes the exact signal the suite exists to produce.
- ENV_FLAKE — nothing is wrong with either; the run hit a timeout, a network hiccup, a
  cold start. The test is retried.
- PLAN_ERROR — the scenario tests a feature this application does not have. It goes back
  to the planning backlog rather than to the Healer.

YOU ARE GIVEN A PRIOR
A rule-based classification computed from Playwright's own error text and from the
record of which locators were resolved on this live page at generation time. It is
usually right and it is always reproducible. Start there.

You may overturn it — that is why you have a browser — but only on something you
observed that the rules could not see. Set agreesWithPrior to false when you do, and say
in the rationale what you saw. "I think it is really an app bug" is not a reason. "The
POST to /api/orders returned 500 and the console shows an uncaught TypeError in
checkout.js" is.

HOW TO LOOK
You have a read-only browser, already signed in as the run's user. Navigate to the route
the failing step was on. Then:
- browser_console_messages — an uncaught exception at the moment of the flow is the
  strongest single signal for APP_DEFECT.
- browser_network_requests — a 4xx or 5xx on the request the flow depends on is the
  second strongest.
- browser_snapshot — is the element the test wanted actually gone, or is it there under a
  different name? An equivalent control with a new label is textbook SCRIPT_DRIFT. No
  such control anywhere, on an application that otherwise works, is closer to PLAN_ERROR.
You cannot click, type or navigate anything into a new state, and you should not want to:
you are reporting on the application, not operating it.

EVIDENCE
Every item you return must be something you observed in this session. Do not restate the
prior's facts as your own — they are already attached. If you looked and found nothing,
say so and let your confidence show it. A hedged verdict with honest evidence is worth
more here than a confident one nobody can check.

CONFIDENCE
Calibrate it. 0.9 means you found the 500. 0.5 means the prior looked reasonable and you
saw nothing either way. The orchestrator publishes this number next to your verdict and
routes on the weakest one in the batch.`;

export async function triage(
  ctx: AgentContext,
  req: { failures: TestResult[] },
): Promise<TriageOutcome[]> {
  const ledgers = await readLedgers(ctx);

  // Everything deterministic first, so that a run which cannot afford the live pass
  // still produces a real classification rather than nothing.
  const prepared = await Promise.all(
    req.failures.map(async (f) => {
      const error = (await readFullError(ctx.runId, f.testId)) ?? f.error ?? "";
      const signals = readSignals(error);
      return { failure: f, error, signals };
    }),
  );

  const cross = correlate(prepared.map((p) => ({ testId: p.failure.testId, signals: p.signals })));

  const priors = prepared.map((p) => {
    const input = {
      signals: p.signals,
      locatorWasProven: locatorWasProven(ledgers.get(p.failure.testId), p.signals),
      alsoFailing: cross.get(p.failure.testId) ?? [],
    };
    const prior = priorVerdict(input);
    return { ...p, input, prior, evidence: priorEvidence(input, prior) };
  });

  ctx.think(
    "classifier",
    `Assembling an evidence bundle for ${priors.length} failure(s): the runner's full error text, the ` +
      "generation-time locator ledger, and cross-test correlation. Each one gets a rule-based prior " +
      "before the model sees it.",
  );

  // The budget path. A classification from the rules alone is a weaker result, not a
  // missing one, and it is reported as exactly that rather than silently downgraded.
  if (ctx.overBudget()) {
    ctx.tool(
      "classifier",
      "budget",
      `Over the $${ctx.input.options.budgetUsd.toFixed(2)} ceiling — classifying from the runner's ` +
        "output and the provenance ledger without the live browser pass.",
      false,
    );
    const outcomes = priors.map((p) => fromPriorOnly(p.failure.testId, p.prior, p.evidence));
    await writeArtifact(ctx.runId, "triage.json", JSON.stringify(outcomes, null, 2));
    return outcomes;
  }

  const outcomes: TriageOutcome[] = [];

  try {
    await withPlaywright(
      ctx.runId,
      ctx.input,
      "classifier",
      async (server) => {
      for (const p of priors) {
        if (ctx.signal.aborted) break;

        ctx.think(
          "classifier",
          `${p.failure.testId}: the rules say ${p.prior.verdict} at ${p.prior.confidence.toFixed(2)}. ` +
            "Going to look at the application before accepting that.",
        );

        let out: TriageOutput;
        try {
          out = await runStructured(ctx, {
            as: "classifier",
            name: `Classifier — ${p.failure.testId}`,
            tier: models.classifier,
            instructions: INSTRUCTIONS,
            input: buildInput(ctx, p.failure, p.error, p.signals, p.prior, p.input.alsoFailing),
            outputType: triageSchema,
            mcpServers: [server],
            maxTurns: MAX_TURNS_PER_FAILURE,
          });
        } catch (err) {
          // A classifier that fell over must not take the failure's classification with
          // it: the prior is a complete answer on its own, and saying so is better than
          // reporting the failure as unclassified.
          if (ctx.signal.aborted) throw err;
          ctx.tool("classifier", "triage", `${p.failure.testId} — the classifier did not finish: ${messageOf(err)}`, false);
          outcomes.push(fromPriorOnly(p.failure.testId, p.prior, p.evidence));
          continue;
        }

        outcomes.push(merge(p.failure.testId, p.prior, p.evidence, out, ctx));
      }
    },
      ctx.target,
    );
  } finally {
    await writeArtifact(ctx.runId, "triage.json", JSON.stringify(outcomes, null, 2));
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Prior ⇄ model
// ---------------------------------------------------------------------------

/**
 * The two layers, combined.
 *
 * Agreement multiplies: two independent methods reaching the same verdict is worth more
 * than either alone, so confidence rises toward the model's own number. Disagreement is
 * where the discipline lives — an overruling that cites live evidence keeps most of its
 * confidence, and one that cites nothing is damped hard and says so in its own rationale,
 * because "the model felt differently" is not a reason to leave a real defect unfiled or
 * to let the Healer at one.
 */
function merge(
  testId: string,
  prior: Prior,
  priorEv: Evidence[],
  out: TriageOutput,
  ctx: AgentContext,
): TriageOutcome {
  const live = toEvidence(out.evidence);
  const agreed = out.verdict === prior.verdict;
  const citesLiveEvidence = live.some((e) => e.kind !== "heuristic");

  let confidence: number;
  let rationale = out.rationale.trim();

  if (agreed) {
    confidence = clamp(Math.max(out.confidence, prior.confidence), 0, 0.97);
  } else if (citesLiveEvidence) {
    confidence = clamp(out.confidence * 0.9, 0, 0.9);
    ctx.tool(
      "classifier",
      "overrule_prior",
      `${testId}: ${prior.verdict} → ${out.verdict}, on live evidence (${live[0]?.summary ?? "cited"})`,
    );
  } else {
    // Overruled the rules with nothing new. The verdict still stands — the model looked
    // at the page and the rules did not — but the run should not act on it as if it were
    // established, and the report must say why the number is low.
    confidence = clamp(Math.min(out.confidence, 0.45), 0, 0.45);
    rationale +=
      ` (Confidence damped: this overturns a ${prior.verdict} prior without citing anything observed live that the` +
      " prior could not see.)";
    ctx.tool(
      "classifier",
      "overrule_prior",
      `${testId}: ${prior.verdict} → ${out.verdict} with no live evidence — confidence damped to ${confidence.toFixed(2)}`,
      false,
    );
  }

  return {
    testId,
    verdict: out.verdict,
    confidence: round2(confidence),
    rationale,
    bug:
      out.verdict === "APP_DEFECT" && out.bugTitle?.trim()
        ? { title: out.bugTitle.trim(), severity: out.bugSeverity ?? "high" }
        : undefined,
    evidence: [
      ...priorEv,
      ...live,
      {
        kind: "heuristic",
        summary: agreed
          ? `Rule-based prior agreed: ${prior.verdict} at ${prior.confidence.toFixed(2)}`
          : `Rule-based prior said ${prior.verdict} at ${prior.confidence.toFixed(2)}; the classifier overruled it`,
        detail: prior.why,
      },
    ],
  };
}

function fromPriorOnly(testId: string, prior: Prior, evidence: Evidence[]): TriageOutcome {
  return {
    testId,
    verdict: prior.verdict,
    // A prior that never got looked at is capped below anything the live pass produces,
    // so the report's confidences stay comparable across the two paths.
    confidence: round2(Math.min(prior.confidence, 0.6)),
    rationale:
      `${prior.why} Classified from the runner's output and the generation-time locator ledger alone — ` +
      "the live browser pass did not run for this failure, so nothing here reflects the application's current state.",
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function buildInput(
  ctx: AgentContext,
  failure: TestResult,
  error: string,
  signals: FailureSignals,
  prior: Prior,
  alsoFailing: string[],
): string {
  return [
    `Target: ${ctx.input.url}`,
    `Failing test: ${failure.testId} — "${failure.title}"`,
    "",
    "The runner's error, in full:",
    "---",
    clip(error, 4000),
    "---",
    "",
    "What the rules read out of it:",
    `- signals: ${signals.kinds.join(", ") || "none recognised"}`,
    `- locator named by the failure: ${signals.locator ?? "none"}`,
    signals.matcher
      ? `- assertion: ${signals.matcher}, expected ${signals.expected ?? "—"}, received ${signals.received ?? "—"}`
      : "- assertion: the failure is not an assertion failure",
    alsoFailing.length
      ? `- the same locator also fails in: ${alsoFailing.join(", ")}`
      : "- no other failing test names this locator",
    "",
    `PRIOR: ${prior.verdict} at confidence ${prior.confidence.toFixed(2)}.`,
    `Because: ${prior.why}`,
    "",
    "Go and look, then classify.",
  ].join("\n");
}

/**
 * Did this locator resolve on the live page when the test was written?
 *
 * Answered by the same code that gates the Generator, against the same ledger, so a
 * "yes" here means precisely what "verified" means there. Playwright prints the locator
 * without its `page.` root, which is the only fixing up needed.
 */
function locatorWasProven(
  ledger: string[] | undefined,
  signals: FailureSignals,
): boolean | undefined {
  if (!ledger || !signals.locator) return undefined;
  const expression = signals.locator.startsWith("page.") ? signals.locator : `page.${signals.locator}`;
  const proof = prove(expression, new Set(ledger));
  return proof.total > 0 ? proof.unproven.length === 0 : undefined;
}

/** testId → the locators that were resolved live while its test was being written. */
async function readLedgers(ctx: AgentContext): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const records = JSON.parse(
      await readFile(runPath(ctx.runId, "selector-provenance.json"), "utf8"),
    ) as { scenarioId?: string; ledger?: string[] }[];
    for (const r of records) {
      // The Generator keys a test's id to its scenario's id, so this joins straight up.
      if (r.scenarioId && Array.isArray(r.ledger)) out.set(r.scenarioId, r.ledger);
    }
  } catch {
    /* No provenance record. `locatorWasProven` returns undefined and the prior says so. */
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.trim().slice(0, 200) || "no reason given";
}
