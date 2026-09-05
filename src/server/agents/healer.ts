/**
 * The Healer — rewrites a broken test, and is not trusted while it does.
 *
 * It runs only on failures the Classifier cleared: `SCRIPT_DRIFT` (the application is
 * fine, the script is wrong) and `ENV_FLAKE`. An `APP_DEFECT` never reaches this file,
 * which is the point — healing a real defect deletes the signal the suite exists to
 * produce, so the gate is placed before the Healer rather than inside it.
 *
 * Three constraints, all enforced outside the model:
 *
 *   1. **It may not weaken what the test proves.** The assertion-integrity guard runs on
 *      the orchestrator's side of this call (`orchestrator/assertion-guard.ts`), and it
 *      is syntactic on purpose: it cannot be argued out of.
 *   2. **It may not write a locator it has not proven** — the Generator's rule, applied
 *      to the patch. Only locators *new to the file* are checked, because the ones it
 *      kept were proven when the test was written; a healer that had to re-prove the
 *      whole file would spend its budget re-deriving what already worked.
 *   3. **It gets a bounded number of attempts**, and non-convergence escalates with the
 *      history attached rather than looping until the budget is gone.
 *
 * `proposeHeal` proposes. Nothing here writes the test file: applying an accepted patch
 * is the orchestrator's act, because the orchestrator is what accepted it.
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { runDir, runPath } from "../paths";
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { siteBriefing } from "./site-policy";
import { healSchema, type HealOutput } from "./schemas";
import { harvest, prove } from "./locator-provenance";
import { keyOf, specsIn, type PwReport } from "./report-keys";
import { readFullError } from "./executor";
import { readSignals } from "./failure-signals";
import type { AgentContext } from "../orchestrator/agents";
import type { HealProposal } from "../orchestrator/fixtures";
import type { TestResult, TriageOutcome } from "@/lib/types";

/** Same shape of ceiling as the Generator's, sized for one file rather than one plan. */
const MAX_TURNS_PER_ATTEMPT = 50;

/** One test, alone, on a machine that just ran a whole suite. Generous, but bounded. */
const RERUN_TIMEOUT_MS = Number(process.env.ODYSSEY_RERUN_TIMEOUT_MS ?? 3 * 60_000);

const INSTRUCTIONS = `You are the Healer in an autonomous end-to-end test pipeline.

One generated test is failing. A defect classifier has already established that the
application is healthy and the test is what is wrong — you are not being asked whether
the failure is real, you are being asked to fix the script.

You have the failing file, the runner's error, the classifier's verdict and evidence,
and a live browser signed in as the run's user.

THE ONE RULE, INHERITED FROM THE GENERATOR
You may not write a locator you have not resolved on the live page in this session. Walk
the application to the state the failing step needs and obtain the replacement from the
page itself — browser_snapshot for refs, browser_generate_locator to turn a ref into the
exact Playwright expression. Every locator in your patch that is not already in the file
is checked against what this session actually resolved, and an unproven one loses the
patch. Locators you leave untouched are fine; they were proven when the test was written.

WHAT YOU MAY CHANGE
Locators. Waits. The order of navigation steps needed to reach a state.

WHAT YOU MAY NOT CHANGE — and this is checked mechanically, before your patch is run
The assertions. Not their count, not their subject's meaning, not their matcher, not
their expected value. You may re-target an assertion at a renamed element; you may not
turn toHaveText('Order #1041') into toBeVisible(), delete an assertion that fails, or
adjust an expected value to match what the app produced. A patch that does any of those
is rejected outright and the test escalates — so weakening an assertion does not make the
test pass, it ends your attempt. If the only way to make this test pass is to stop
checking something, decline instead: that is a correct and useful answer.

ALSO FORBIDDEN, for the same reason
No page.waitForTimeout and no bare sleeps — use web-first assertions. No try/catch that
swallows the failure. No conditional that lets the test pass either way. No test.skip.
Do not touch the test's title.

WHEN TO DECLINE
Return outcome "decline" when the element genuinely is not on the application any more,
when the flow the test describes cannot be performed at all, or when the only available
fix is one of the forbidden ones. Say which. An escalation with a precise reason is a
result; a test that passes because it stopped looking is a liability.

Return the COMPLETE patched file, not a diff.`;

/**
 * The prompt, plus everything the preflight learned about this particular target.
 *
 * With no preflight this is the constant it always was — the briefing is additive, and a
 * run without one behaves exactly as it did before target profiling existed.
 */
function instructions(ctx: AgentContext): string {
  if (!ctx.target) return INSTRUCTIONS;
  return `${INSTRUCTIONS}\n\n${siteBriefing(ctx.target.profile, ctx.target.policy, "healer")}`;
}

export async function proposeHeal(
  ctx: AgentContext,
  req: { testId: string; attempt: number; triage: TriageOutcome },
): Promise<HealProposal | null> {
  const file = await locateSpec(ctx, req.testId);
  if (!file) {
    ctx.tool("healer", "Read", `No spec file on disk for ${req.testId} — nothing to patch.`, false);
    return null;
  }

  const before = await readFile(runPath(ctx.runId, file), "utf8");
  const error = (await readFullError(ctx.runId, req.testId)) ?? "";

  if (ctx.overBudget()) {
    ctx.tool(
      "healer",
      "budget",
      `Over the $${ctx.input.options.budgetUsd.toFixed(2)} ceiling — ${req.testId} escalates unhealed rather than spending past it.`,
      false,
    );
    return null;
  }

  ctx.think(
    "healer",
    `${req.testId}, attempt ${req.attempt}: replaying the failing step against the live page to find what ` +
      `the ${readSignals(error).locator ?? "locator"} became.`,
  );

  const ledger = new Set<string>();
  let out: HealOutput;
  try {
    out = await withPlaywright(
      ctx.runId,
      ctx.input,
      "healer",
      (server) =>
      runStructured(ctx, {
        as: "healer",
        name: `Healer — ${req.testId} #${req.attempt}`,
        tier: models.healer,
        instructions: instructions(ctx),
        input: buildInput(ctx, req, file, before, error),
        outputType: healSchema,
        mcpServers: [server],
        maxTurns: MAX_TURNS_PER_ATTEMPT,
        onTool: (obs) => {
          if (obs.ok) harvest(ledger, obs.output);
        },
      }),
      ctx.target,
    );
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    // A wedged heal attempt costs that attempt, not the stage — the same rule the
    // Generator learned the hard way when one stuck scenario discarded nine others.
    ctx.tool("healer", "heal", `${req.testId} — the Healer did not finish this attempt: ${messageOf(err)}`, false);
    return null;
  }

  if (out.outcome === "decline" || !out.code?.trim()) {
    ctx.tool("healer", "decline", `${req.testId} — ${out.summary || "the Healer declined to patch this test"}`, false);
    return null;
  }

  const after = out.code.trim() + "\n";

  // The provenance gate, narrowed to what the patch introduced. A locator the file
  // already carried was proven when the test was written; re-proving it would cost a
  // browser walk to establish something already on the record.
  const introduced = newLocators(before, after, ledger);
  if (introduced.unproven.length) {
    ctx.tool(
      "healer",
      "verify_locator_provenance",
      `${req.testId} — the patch introduces ${introduced.unproven.length} locator(s) this session never resolved: ` +
        `${introduced.unproven.slice(0, 3).join(", ")}. Rejected; a guessed locator is how a healer turns one red ` +
        "test into two.",
      false,
    );
    return null;
  }

  ctx.tool(
    "healer",
    "verify_locator_provenance",
    introduced.total
      ? `${req.testId} — all ${introduced.total} new locator(s) in the patch were resolved on the live page`
      : `${req.testId} — the patch introduces no new locators`,
  );

  return { testId: req.testId, file, summary: out.summary.trim() || "Patched the failing step", before, after };
}

// ---------------------------------------------------------------------------
// Re-running one test
// ---------------------------------------------------------------------------

/**
 * Runs a single spec file and reports what happened to it.
 *
 * Deliberately the executor's invocation narrowed to one file rather than a second way
 * of running Playwright: same resolved CLI, same config, same workspace cwd, same JSON
 * report read back through the same `keyOf` match that bug 2 taught us to use. A rerun
 * that ran the suite differently from the first pass would not be evidence about the
 * first pass.
 */
export async function rerun(
  ctx: AgentContext,
  req: { testId: string; attempt: number; healed: boolean },
): Promise<TestResult> {
  const file = await locateSpec(ctx, req.testId);
  const title = (await titleOf(ctx, req.testId)) ?? req.testId;

  if (!file) {
    return result(req, title, "failed", 0, `No spec file on disk for ${req.testId}.`);
  }

  ctx.tool(
    "runner",
    "Bash",
    `playwright test ${file}${req.healed ? " (after an accepted patch)" : " (retrying a suspected flake)"}`,
  );

  const run = await spawnOne(ctx, file);
  const report = await readReport(ctx, REPORT_FILE);

  if (!report) {
    return result(req, title, "failed", run.durationMs, `The runner produced no report for the rerun (exit ${run.code}).`);
  }

  const workspace = runDir(ctx.runId);
  const rootDir = report.config?.rootDir || workspace;
  const specs = specsIn(report).filter((s) => keyOf(s.file, rootDir, workspace) === keyOf(file, workspace, workspace));
  const outcomes = specs.flatMap((s) => s.tests ?? []).flatMap((t) => t.results ?? []);

  const durationMs = outcomes.reduce((n, r) => n + (r.duration ?? 0), 0);
  const passed = outcomes.length > 0 && outcomes.every((r) => r.status === "passed");
  const error = outcomes.map((r) => r.error?.message).find(Boolean);

  if (!passed) {
    ctx.tool("runner", "playwright", `${req.testId} is still red after the rerun.`, false);
    return result(req, title, "failed", durationMs, error ? clip(stripAnsi(error)) : "The rerun produced no passing result.");
  }

  ctx.tool(
    "runner",
    "playwright",
    req.healed ? `${req.testId} passes after the patch.` : `${req.testId} passed on retry — the first failure was a flake.`,
  );
  // "healed" and "passed" are different facts and the report counts them separately: a
  // test that needed a patch to go green is not the same result as one that was green
  // the second time nobody touched it.
  return result(req, title, req.healed ? "healed" : "passed", durationMs);
}

/**
 * The rerun's own JSON report.
 *
 * A separate file from the suite's: `results/results.json` is the record of the first
 * pass and triage reads it, so a single-test rerun overwriting it would erase the
 * evidence for every other failure in the run.
 */
const REPORT_FILE = "results/rerun.json";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function buildInput(
  ctx: AgentContext,
  req: { testId: string; attempt: number; triage: TriageOutcome },
  file: string,
  before: string,
  error: string,
): string {
  return [
    `Target: ${ctx.input.url}`,
    `Failing test: ${req.testId} (${file}) — heal attempt ${req.attempt}.`,
    "",
    "The classifier's verdict:",
    `${req.triage.verdict} at confidence ${req.triage.confidence.toFixed(2)} — ${req.triage.rationale}`,
    "Evidence it cited:",
    ...req.triage.evidence.map((e) => `- [${e.kind}] ${e.summary}${e.detail ? ` (${e.detail})` : ""}`),
    "",
    "The runner's error:",
    "---",
    clip(error, 3000),
    "---",
    "",
    "The current file, in full:",
    "---",
    before,
    "---",
  ].join("\n");
}

/**
 * Which locators the patch adds that the file did not already have.
 *
 * `prove` is run over both versions and the difference taken, so this is the same
 * canonicalisation the Generator's gate uses — a locator rewritten only in its quoting
 * style is not a new locator, and would otherwise cost a healer its patch.
 */
function newLocators(before: string, after: string, ledger: Set<string>) {
  const existing = new Set(prove(before, new Set()).unproven);
  const proof = prove(after, ledger);
  const introducedUnproven = proof.unproven.filter((l) => !existing.has(l));
  // `total` here is how many the patch introduced at all, proven or not — the number the
  // narration reports when the gate passes.
  const total = prove(after, new Set()).unproven.filter((l) => !existing.has(l)).length;
  return { total, unproven: introducedUnproven };
}

/** The spec file for a test id, from the provenance record the Generator wrote. */
async function locateSpec(ctx: AgentContext, testId: string): Promise<string | undefined> {
  return (await provenanceFor(ctx, testId))?.file;
}

/** The scenario's title, so a rerun's result reads the same as the first pass's. */
async function titleOf(ctx: AgentContext, testId: string): Promise<string | undefined> {
  return (await provenanceFor(ctx, testId))?.title;
}

/** This test's row of the record the Generator wrote — the file and the title both. */
async function provenanceFor(
  ctx: AgentContext,
  testId: string,
): Promise<{ file?: string; title?: string } | undefined> {
  try {
    const records = JSON.parse(
      await readFile(runPath(ctx.runId, "selector-provenance.json"), "utf8"),
    ) as { scenarioId?: string; file?: string; title?: string }[];
    return records.find((r) => r.scenarioId === testId);
  } catch {
    return undefined;
  }
}

function result(
  req: { testId: string; attempt: number },
  title: string,
  status: TestResult["status"],
  durationMs: number,
  error?: string,
): TestResult {
  return { id: `${req.testId}-${req.attempt}`, testId: req.testId, title, status, durationMs, attempt: req.attempt, error };
}

function playwrightCli(): string {
  const resolve = createRequire(path.join(process.cwd(), "package.json"));
  return path.join(path.dirname(resolve.resolve("@playwright/test/package.json")), "cli.js");
}

function spawnOne(
  ctx: AgentContext,
  file: string,
): Promise<{ code: number | null; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [playwrightCli(), "test", file, "--reporter", `json`, "--workers", "1"],
      {
        cwd: runDir(ctx.runId),
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          // The config's own reporter list writes `results/results.json`, which is the
          // first pass's record. Playwright's own env override is the supported way to
          // send this one somewhere else without editing the config the suite ships with.
          PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT_FILE,
        },
        stdio: ["ignore", "ignore", "ignore"] as const,
      },
    );

    const kill = () => child.kill("SIGTERM");
    const timer = setTimeout(kill, RERUN_TIMEOUT_MS);
    ctx.signal.addEventListener("abort", kill, { once: true });

    const finish = (code: number | null) => {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", kill);
      resolve({ code, durationMs: Date.now() - started });
    };
    child.on("error", () => finish(null));
    child.on("close", finish);
  });
}

async function readReport(ctx: AgentContext, file: string): Promise<PwReport | null> {
  try {
    return JSON.parse(await readFile(runPath(ctx.runId, file), "utf8")) as PwReport;
  } catch {
    return null;
  }
}

const ANSI = /\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");
const clip = (s: string, n = 600) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.trim().slice(0, 200) || "no reason given";
}
