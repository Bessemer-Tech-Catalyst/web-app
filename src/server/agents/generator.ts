/**
 * The Generator — turns a plan scenario into a Playwright test whose every locator was
 * resolved on the live page first.
 *
 * The rule that makes this worth building (§3.2, and idea 2 in PLAN.md): *it is not
 * allowed to write a selector it has not proven.* A scenario whose elements cannot be
 * found is quarantined with a reason. Twelve honest green tests plus "eight scenarios
 * held back, here is exactly why" is a better product than forty tests of which
 * thirty-eight are red — and it is a much better demo.
 *
 * That rule is enforced twice, in two different currencies:
 *
 *   - the agent is *told* to prove each element and to quarantine when it cannot, and
 *   - the code it hands back is then checked, mechanically, against a ledger of every
 *     locator Playwright itself resolved during the session (`locator-provenance.ts`).
 *
 * The second one is the one that counts. The first is cooperation; only the second is a
 * measurement, and `selectorsVerified` on the emitted test is that measurement, not a
 * number anybody chose.
 *
 * The Generator recommends; it does not decide. It returns `emit` or `quarantine` and
 * the orchestrator's gate can still overrule an `emit` — a scenario carrying an unproven
 * locator is quarantined whatever the agent thought of it.
 *
 * One agent run per scenario, sharing one browser. Scenarios are independent, a wedged
 * one should cost one scenario rather than the stage, and a per-scenario run keeps the
 * narration in the Decision Log legible as "now working on X".
 */

import { readFile } from "node:fs/promises";
import { runPath } from "../paths";
import { writeArtifact, writePlaywrightConfig } from "../workspace";
import { withPlaywright } from "./playwright-mcp";
import { runStructured } from "./harness";
import { models } from "./models";
import { generatedTestSchema, type GeneratedTestOutput } from "./schemas";
import { harvest, prove } from "./locator-provenance";
import { credentialsBriefing, redactPassword } from "./credentials";
import {
  STATE_FILE,
  captureStorageState,
  carriesSession,
  describeStorageState,
  readStorageState,
} from "./storage-state";
import type { AgentContext, GenerateResult, ReconResult } from "../orchestrator/agents";
import type { GeneratedTest, Scenario } from "@/lib/types";

/**
 * Per-scenario ceiling on agentic looping.
 *
 * Raised from the harness default of 40 on measurement, not on feel. At 40, four of ten
 * scenarios in one run were cut off mid-proof, holding 12, 35, 11 and 17 resolved
 * locators apiece — and the tool mix says that was work, not thrashing: 31
 * `browser_generate_locator` calls in one scenario, eight `select_option` and eight
 * `verify_value` in another, with one to seven failed calls out of thirty-three to
 * seventy-nine. The distinguishable flailing signature — twenty consecutive
 * `browser_press_key` calls hunting for a way around a button that would not accept a
 * click — is what the "stop after two refused interactions" instruction below addresses,
 * and it does not appear at all once that instruction is in the prompt.
 *
 * So this is a backstop against a wedged agent, not a work budget, and it is sized to
 * clear the widest scenario observed rather than the median one. Hitting it costs one
 * quarantined scenario, and the reason says so in the report, which is how a ceiling
 * that is still too low will make itself known.
 */
const MAX_TURNS_PER_SCENARIO = 80;

const INSTRUCTIONS = `You are the Generator in an autonomous end-to-end test pipeline.

You are given one scenario from a test plan and a live browser that is already signed in
as the run's user. You produce one Playwright test file for that scenario — or you
decline to, and say why.

THE ONE RULE
You may not write a locator you have not resolved on the live page in this session.
Not one you remember, not one that looks right, not one adapted from a locator you did
resolve. Walk the application to the state the scenario describes and obtain each
element's locator from the page:

- browser_snapshot gives you refs; browser_generate_locator turns a ref into the exact
  Playwright expression to put in the test. This is the tool that matters — use it for
  every element the test will touch.
- browser_verify_element_visible, browser_verify_value and browser_verify_text_visible
  prove an assertion holds before you write it.
- Every click, fill and select you perform reports back the Playwright code it ran. That
  code is a resolved locator too, and you may use it.

The file you hand back is checked against the locators actually resolved in this
session. A locator that is not among them is treated as a guess and the whole scenario
is quarantined, so inventing one costs you the test rather than saving it.

WALKING THE APP
- An empty snapshot means the page has not hydrated, not that it is empty. Wait a
  moment and snapshot again before concluding anything.
- Reach the state the scenario needs. A confirmation dialog's buttons do not exist until
  something opens the dialog, so open it.
- You are working against a real application with real data. Open a destructive
  confirmation to prove its controls exist, then DISMISS it — never confirm. The test you
  write may include the confirming click; you must not perform it yourself.
- Do not create, delete or send anything you do not have to.
- If an element refuses to be interacted with — a click that times out, a field that
  will not take a value — try once more, then stop. Do not hunt for a way around it with
  keyboard navigation or repeated retries; you will spend the scenario's budget and
  still have nothing. An element the application will not let you operate is exactly
  what quarantine is for: say which element, what you tried, and what it did.
- Never sign out. The session you are browsing in is shared with the scenarios generated
  after yours, and ending it strands them. If your scenario covers signing out, prove the
  sign-out control is visible and get its locator — do not click it.

THE FILE
- TypeScript, importing { test, expect } from "@playwright/test".
- Exactly one test() call, titled with the scenario's title.
- The browser starts signed in and baseURL is configured: navigate with relative paths
  like page.goto("/settings"). Never write sign-in steps and never hardcode the origin.
- UNLESS the scenario is about signed-out behaviour — rejected credentials, a protected
  route redirecting, what an anonymous visitor sees. The suite ships one signed-in
  session, so a test that merely navigates to the login page while holding it is testing
  the signed-in application and will fail on every assertion about being signed out. Such
  a test must drop the session for itself, on the line after the imports:
      test.use({ storageState: { cookies: [], origins: [] } });
  Write that only when the scenario genuinely requires an anonymous session, and then
  write the sign-in steps the scenario needs, since there is no session to inherit. The
  run's credentials are given to you below; a signed-out scenario is not a reason to
  quarantine when you have been handed an account to sign in with.
- Assert the scenario's expected outcome, specifically enough to fail when it is wrong.
  A test that only asserts the page loaded proves nothing.
- Use web-first assertions — expect(locator).toBeVisible(), .toHaveText(), .toHaveURL().
  Never page.waitForTimeout, never a bare sleep, never a try/catch that swallows a
  failure, never a conditional that makes the test pass either way.
- No comments claiming a locator was verified. The provenance record is kept elsewhere.

EMIT OR QUARANTINE — decide in this order
1. Did you reach the scenario's main flow, and can you prove at least one assertion that
   would fail if that flow were broken? If yes, **emit**. Put in the test every clause you
   proved, and use "reason" to name the clauses you dropped and why.
2. Only if the answer is no — the page is not there, the state cannot be reached at all,
   the flow needs data that does not exist — return "quarantine", naming what was missing
   and where you looked.

A clause you could not reach is not a reason to throw away the clauses you did. A run that
walked checkout, proved the confirmation identifier, the basket emptying and the total, and
then quarantined the whole scenario because the orders page shows no date, has spent the
money and produced nothing — and the missing date is reported anyway, by the report, as a
gap. That is a worse outcome than the partial test in every respect.

Quarantine is a genuinely useful result and it is reported as one: a quarantined scenario
with a precise reason is worth more to the team than a test that fails for a reason nobody
can read. It is not a way to avoid committing to what you found.`;

export async function generate(
  ctx: AgentContext,
  req: { scenarios: Scenario[] },
): Promise<GenerateResult> {
  const tier = models.generator;
  const recon = await readRecon(ctx);

  const tests: GeneratedTest[] = [];
  const quarantined: GenerateResult["quarantined"] = [];
  const provenance: Record<string, unknown>[] = [];
  const filenames = new Set<string>();

  // try/finally, because `selector-provenance.json` is the file the run is debugged
  // from. Losing it precisely when something went wrong — which is what happens if the
  // browser session throws on the way out — is losing it when it is worth the most.
  try {
    await withPlaywright(ctx.runId, ctx.input, "generator", async (server) => {
      // --- the auth hand-off ---------------------------------------------------
      // Done before any scenario, because it reads the session the *shared profile* holds
      // and the first thing the agent does is start navigating around inside it.
      ctx.think(
        "generator",
        "Dumping the signed-in session out of the shared browser profile: `playwright test` " +
          "cannot use a Chrome user-data-dir, so the suite needs its own storage-state file.",
      );

      // Re-dumped here rather than reused from Recon because this browser has been
      // signed in for the whole generate stage: a token Recon captured an hour of agent
      // work ago may have been rotated since, and the suite runs from this file. A
      // capture that comes back empty does not overwrite Recon's (see `storage-state.ts`),
      // so the fallback below is a real session and not a stale husk.
      const captured = await captureStorageState(ctx.runId, ctx.input.url, server);
      const state = captured && carriesSession(captured) ? captured : await readStorageState(ctx.runId);

      if (state && carriesSession(state)) {
        ctx.tool("generator", "browser_storage_state", describeStorageState(state));
        await writePlaywrightConfig(ctx.runId, ctx.input, { storageState: STATE_FILE });
        ctx.artifact("plan", "playwright.config.ts", "Suite config — signed-in storage state");
      } else {
        // Reported as a failed call rather than skipped quietly. On a credentialed run
        // this is the difference between a suite and a suite that is logged out, and the
        // symptom downstream — every test failing on a login redirect — looks nothing
        // like its cause.
        ctx.tool(
          "generator",
          "browser_storage_state",
          captured
            ? `Captured nothing: 0 cookies and 0 localStorage entries at ${ctx.input.url}, and ` +
                "no session was on file from Recon either. " +
                (recon?.authenticated
                  ? "Recon reported an authenticated session, so the suite will run logged out."
                  : "No session was established for this run.")
            : `Could not read ${STATE_FILE}; the suite will run without a session.`,
          false,
        );
      }

      // --- one scenario at a time ----------------------------------------------
      for (const [i, scenario] of req.scenarios.entries()) {
        if (ctx.signal.aborted) break;

        // This is the stage the budget ceiling exists for: one live browsing agent per
        // scenario, and by far the largest line on the bill. Stopping between scenarios
        // rather than mid-scenario keeps every emitted test whole, and the scenarios that
        // never ran are reported as held rather than quietly missing — a run that stopped
        // early and a run that found nothing must not look the same in the report.
        if (ctx.overBudget()) {
          for (const held of req.scenarios.slice(i)) {
            const reason =
              `Not attempted: the run passed its $${ctx.input.options.budgetUsd.toFixed(2)} budget ` +
              "ceiling before this scenario started.";
            quarantined.push({ scenarioId: held.id, title: held.title, reason });
            provenance.push({ scenarioId: held.id, title: held.title, outcome: "not-attempted-over-budget", reason, ledger: [] });
          }
          ctx.tool(
            "generator",
            "budget",
            `Stopped after ${i} of ${req.scenarios.length} scenario(s) — the run is over its ` +
              `$${ctx.input.options.budgetUsd.toFixed(2)} ceiling.`,
            false,
          );
          break;
        }

        ctx.think(
          "generator",
          `Scenario ${i + 1}/${req.scenarios.length} — "${scenario.title}". Walking the app to ` +
            "each element it needs before writing anything.",
        );

        // One ledger per scenario. A locator proven while working on a different flow, on
        // a page this test never opens, is not evidence about this test.
        const ledger = new Set<string>();

        // The header's promise — "a wedged one should cost one scenario rather than the
        // stage" — is only true if this throw is caught. It is not hypothetical: a run
        // died here with `Max turns (40) exceeded` on scenario 4 of 10, discarding the
        // nine scenarios after it, the one test already emitted, and the provenance
        // record that would have explained any of it. A scenario the Generator could not
        // finish is a quarantined scenario, which is a result; it is not a dead run.
        let out: GeneratedTestOutput;
        try {
          out = await runStructured(ctx, {
            as: "generator",
            name: `Generator — ${scenario.id}`,
            tier,
            instructions: INSTRUCTIONS,
            input: buildInput(ctx, scenario, recon),
            outputType: generatedTestSchema,
            mcpServers: [server],
            maxTurns: MAX_TURNS_PER_SCENARIO,
            onTool: (obs) => {
              if (obs.ok) harvest(ledger, obs.output);
            },
          });
        } catch (err) {
          // A cancelled or over-budget run is the orchestrator ending the stage, not this
          // scenario failing. Quarantining the remaining nine would report a decision the
          // Generator never made.
          if (ctx.signal.aborted) throw err;
          const reason = `The Generator did not finish this scenario: ${messageOf(err)}`;
          quarantined.push({ scenarioId: scenario.id, title: scenario.title, reason });
          ctx.tool("generator", "quarantine", `${scenario.title} — ${reason}`, false);
          provenance.push({
            scenarioId: scenario.id,
            title: scenario.title,
            outcome: "quarantined-by-error",
            reason,
            ledger: [...ledger],
          });
          continue;
        }

        const file = `tests/${unique(slug(scenario.id), filenames)}.spec.ts`;

        if (out.outcome === "quarantine" || !out.code?.trim()) {
          quarantined.push({ scenarioId: scenario.id, title: scenario.title, reason: reasonOf(out.reason) });
          ctx.tool("generator", "quarantine", `${scenario.title} — ${reasonOf(out.reason)}`, false);
          provenance.push({ scenarioId: scenario.id, title: scenario.title, outcome: "quarantined-by-agent", reason: reasonOf(out.reason), ledger: [...ledger] });
          continue;
        }

        // The gate. Everything above this line is the agent's account of its own work;
        // this is the part that checked.
        const proof = prove(out.code, ledger);

        if (proof.unproven.length || proof.total === 0) {
          const reason =
            proof.total === 0
              ? "The emitted test used no locators at all, so it asserts nothing about the page."
              : `${proof.unproven.length} of ${proof.total} locators in the generated test were never ` +
                `resolved on the live page: ${proof.unproven.slice(0, 3).join(", ")}` +
                (proof.unproven.length > 3 ? ", …" : "") +
                ". Emitting them would be guessing.";
          quarantined.push({ scenarioId: scenario.id, title: scenario.title, reason });
          ctx.tool("generator", "verify_locator_provenance", `${scenario.title} — ${reason}`, false);
          provenance.push({ scenarioId: scenario.id, title: scenario.title, outcome: "quarantined-by-gate", proof, ledger: [...ledger] });
          continue;
        }

        // The password, if the agent wrote one, is rewritten to an environment read
        // before the file exists on disk. See `credentials.ts`.
        const redacted = redactPassword(out.code.trim(), ctx.input.credentials?.password ?? "");
        if (redacted.count) {
          ctx.tool(
            "generator",
            "redact_credentials",
            `${file} — ${redacted.count} literal password occurrence(s) rewritten to ` +
              "process.env.ODYSSEY_PASSWORD; the runner supplies it.",
          );
        }
        if (redacted.residual) {
          ctx.tool(
            "generator",
            "redact_credentials",
            `${file} — the password still appears inside a longer string literal, which the ` +
              "rewrite will not splice. Review the file before committing it.",
            false,
          );
        }

        if (out.reason?.trim()) {
          // An emit that still dropped something. Reported, because a test that covers
          // three of a scenario's four clauses and says so is honest, and one that covers
          // three and says nothing is a coverage claim nobody can check.
          ctx.tool(
            "generator",
            "partial_emit",
            `${scenario.title} — emitted, with a clause dropped: ${reasonOf(out.reason)}`,
          );
        }

        await writeArtifact(ctx.runId, file, redacted.code + "\n");
        const test: GeneratedTest = {
          id: scenario.id,
          scenarioId: scenario.id,
          title: scenario.title,
          file,
          selectorsVerified: proof.verified,
          selectorsTotal: proof.total,
        };
        tests.push(test);
        ctx.tool(
          "generator",
          "verify_locator_provenance",
          `${file} — ${proof.verified}/${proof.total} locators resolved on the live page`,
        );
        ctx.artifact("test", file, scenario.title, test.id);
        provenance.push({ scenarioId: scenario.id, title: scenario.title, outcome: "emitted", file, proof, ledger: [...ledger] });
      }
    });
  } finally {
    // Kept as an artifact because it is the evidence behind every selector-provenance
    // claim the report makes, and because Phase 5's classifier asks "did this locator
    // resolve at generation time?" of exactly this file.
    await writeArtifact(
      ctx.runId,
      "selector-provenance.json",
      JSON.stringify(provenance, null, 2),
    );
  }

  return { tests, quarantined };
}

/** The prompt's variable half. */
function buildInput(ctx: AgentContext, scenario: Scenario, recon: ReconResult | null): string {
  const lines = [
    `Target: ${ctx.input.url}`,
    recon
      ? `Routes Recon reached: ${recon.routes.join(", ")}`
      : "(recon.json is unavailable — discover the routes you need from the page itself)",
    `Session: ${recon?.authenticated ? "signed in" : "not authenticated"}.`,
    "",
    "Scenario to implement:",
    "---",
    JSON.stringify(
      {
        id: scenario.id,
        title: scenario.title,
        flow: scenario.flow,
        kind: scenario.kind,
        priority: scenario.priority,
        steps: scenario.steps,
        expected: scenario.expected,
      },
      null,
      2,
    ),
    "---",
    ...credentialsBriefing(ctx.input.credentials),
  ];
  if (ctx.input.intent) {
    lines.push("", `The run's stated intent, for context: ${ctx.input.intent}`);
  }
  return lines.join("\n");
}

async function readRecon(ctx: AgentContext): Promise<ReconResult | null> {
  try {
    return JSON.parse(await readFile(runPath(ctx.runId, "recon.json"), "utf8")) as ReconResult;
  } catch {
    return null;
  }
}

/** An Error's message, or whatever a non-Error throw can be made to say. */
function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const trimmed = text.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 299)}…` : trimmed || "no reason given";
}

function reasonOf(reason: string): string {
  const trimmed = reason.trim();
  return trimmed || "The Generator declined to emit a test and gave no reason.";
}

/** Scenario ids are model-authored, and they become filenames. */
function slug(id: string): string {
  const cleaned = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "scenario";
}

/** Two scenarios sluggifying to the same name must not overwrite each other's file. */
function unique(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name}-${n}`;
  taken.add(candidate);
  return candidate;
}
