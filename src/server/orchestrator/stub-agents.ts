/**
 * Deterministic stand-ins for the real agents (Phase 2).
 *
 * They emit the same narration, tool calls and artifacts the real ones will, at
 * roughly the same pacing, and they write real files into the run workspace — so the
 * transport, the event log, the crash-recovery path and the UI are all exercised
 * exactly as they will be in production. Only the thinking is fake.
 *
 * `ODYSSEY_STUB_SPEED` divides every delay; set it high in tests.
 */

import { writeArtifact } from "../workspace";
import type {
  Agents,
  GenerateResult,
  PlanRequest,
  ReconResult,
} from "./agents";
import * as fx from "./fixtures";
import type {
  Critique,
  GeneratedTest,
  PrdRequirement,
  RiskItem,
  Scenario,
  TestResult,
  TriageOutcome,
} from "@/lib/types";
import type { HealProposal } from "./fixtures";

const SPEED = Number(process.env.ODYSSEY_STUB_SPEED ?? 1) || 1;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const wait = Math.max(1, ms / SPEED);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, wait);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const stubAgents: Agents = {
  async recon(ctx): Promise<ReconResult> {
    ctx.think("recon", "Opening the target and establishing a baseline session before crawling.");
    await sleep(500, ctx.signal);
    ctx.tool("recon", "browser_navigate", `Loaded ${ctx.input.url} — 200 OK, 1.2s`);
    await sleep(420, ctx.signal);
    ctx.tool("recon", "browser_snapshot", "Captured accessibility tree — 84 nodes, 19 interactive");

    if (ctx.input.credentials) {
      await sleep(560, ctx.signal);
      ctx.tool("recon", "browser_fill_form", "Submitted the sign-in form as the supplied user");
      await sleep(480, ctx.signal);
      ctx.tool("recon", "browser_snapshot", "Authenticated — account menu present, session cookie set");
    }

    await sleep(600, ctx.signal);
    ctx.tool("recon", "browser_navigate", "Breadth-first crawl, depth 2 — 12 routes discovered");

    const result: ReconResult = {
      routes: fx.ROUTES,
      authenticated: !!ctx.input.credentials,
      evidence: [
        { kind: "heuristic", summary: "84 a11y nodes vs ~3,400 DOM nodes on the landing page" },
        {
          kind: "heuristic",
          summary: "Reachable but unplanned surfaces: /forgot-password, /admin, empty-cart state",
        },
      ],
    };

    await writeArtifact(ctx.runId, "recon.json", JSON.stringify(result, null, 2));
    ctx.artifact("plan", "recon.json", `Recon map — ${result.routes.length} routes, 19 interactive surfaces`);
    ctx.spend(0.21, 18_400, 2_100);
    return result;
  },

  async plan(ctx, req: PlanRequest): Promise<Scenario[]> {
    ctx.think(
      "planner",
      req.attempt === 1
        ? ctx.input.intent
          ? `Scoping the plan around the stated intent: "${ctx.input.intent}".`
          : "No stated intent — planning broadly across every discovered surface."
        : `Applying ${req.directives.length} critic directives — negative, permission, edge and destructive cases.`,
    );
    await sleep(700, ctx.signal);
    ctx.tool(
      "planner",
      req.attempt === 1 ? "browser_snapshot" : "browser_navigate",
      req.attempt === 1
        ? "Re-read /products and /checkout to ground the steps"
        : "Probed /admin as a shopper to confirm it is reachable",
    );

    const scenarios = req.attempt === 1 ? fx.PLAN_V1 : fx.PLAN_V2;
    await sleep(650, ctx.signal);

    const path = await writeArtifact(ctx.runId, "specs/core.md", renderSpec(ctx.input.url, scenarios));
    ctx.tool("planner", "Write", `${path} — ${scenarios.length} scenarios`);
    ctx.artifact(
      "plan",
      path,
      `Test plan v${req.attempt} — ${scenarios.length} scenarios` +
        (req.attempt > 1 ? ` (${scenarios.filter((s) => s.addedByCritique).length} added by critique)` : ""),
    );
    ctx.spend(req.attempt === 1 ? 0.34 : 0.41, req.attempt === 1 ? 22_800 : 26_100, req.attempt === 1 ? 4_600 : 7_300);
    return scenarios;
  },

  async critique(ctx, req): Promise<Critique> {
    ctx.think("critic", "Scoring the plan against the coverage rubric using the recon map as ground truth.");
    await sleep(900, ctx.signal);
    const critique = req.attempt === 1 ? fx.CRITIQUE_V1 : fx.CRITIQUE_V2;
    await writeArtifact(ctx.runId, "critique.json", JSON.stringify(critique, null, 2));
    return critique;
  },

  async generate(ctx, req): Promise<GenerateResult> {
    ctx.think("generator", "Every locator must resolve on the live page before it is written to a file.");
    await sleep(450, ctx.signal);
    await writeArtifact(ctx.runId, "tests/seed.spec.ts", SEED_SPEC);
    ctx.tool("generator", "Write", "tests/seed.spec.ts — session bootstrap");

    const planned = new Set(req.scenarios.map((s) => s.id));
    const tests: GeneratedTest[] = [];

    for (const t of fx.GENERATED.filter((g) => planned.has(g.scenarioId))) {
      await sleep(260, ctx.signal);
      ctx.tool(
        "generator",
        "browser_generate_locator",
        `${t.title} — ${t.selectorsVerified}/${t.selectorsTotal} locators resolved`,
      );
      await writeArtifact(ctx.runId, t.file, specFor(t));
      tests.push(t);
      ctx.artifact("test", t.file, t.title);
    }

    const quarantined: GenerateResult["quarantined"] = [];
    for (const q of fx.QUARANTINED.filter((q) => planned.has(q.scenarioId))) {
      await sleep(300, ctx.signal);
      ctx.tool(
        "generator",
        "browser_verify_element_visible",
        `${q.title} — could not resolve required elements`,
        false,
      );
      quarantined.push(q);
    }

    ctx.spend(1.12, 61_400, 22_900);
    return { tests, quarantined };
  },

  async execute(ctx, req): Promise<TestResult[]> {
    ctx.tool(
      "runner",
      "Bash",
      `npx playwright test --workers=${ctx.input.options.parallelWorkers} --reporter=json`,
    );
    const byId = new Map(req.tests.map((t) => [t.id, t]));
    const out: TestResult[] = [];

    for (const spec of fx.RESULTS_PASS_1) {
      const test = byId.get(spec.testId);
      if (!test) continue;
      await sleep(340, ctx.signal);
      const result: TestResult = {
        id: `${spec.testId}-${req.attempt}`,
        testId: spec.testId,
        title: test.title,
        status: spec.status,
        durationMs: spec.durationMs,
        attempt: req.attempt,
        error: spec.error,
      };
      out.push(result);
      if (spec.status === "failed") {
        ctx.artifact("trace", `results/traces/${spec.testId}.zip`, `Trace — ${test.title}`);
      }
    }

    await writeArtifact(ctx.runId, "results/results.json", JSON.stringify(out, null, 2));
    ctx.spend(0.08, 4_200, 900);
    return out;
  },

  async triage(ctx, req): Promise<TriageOutcome[]> {
    ctx.think(
      "classifier",
      "Assembling an evidence bundle per failure — snapshot diff, console, network, provenance.",
    );
    const wanted = new Set(req.failures.map((f) => f.testId));
    const out: TriageOutcome[] = [];
    for (const outcome of fx.TRIAGE.filter((t) => wanted.has(t.testId))) {
      await sleep(320, ctx.signal);
      ctx.tool("classifier", "browser_snapshot", `Re-snapshotted the failure page for ${outcome.testId}`);
      out.push(outcome);
    }
    ctx.spend(0.47, 31_700, 6_800);
    return out;
  },

  async proposeHeal(ctx, req): Promise<HealProposal | null> {
    const proposals = fx.HEAL_PROPOSALS[req.testId];
    const proposal = proposals?.[req.attempt - 1];
    if (!proposal) return null;

    ctx.think("healer", `Replaying ${req.testId} step by step against the live page (attempt ${req.attempt}).`);
    await sleep(420, ctx.signal);
    ctx.tool("healer", "browser_snapshot", "Re-read the failure page to locate the equivalent control");
    await sleep(300, ctx.signal);
    return proposal;
  },

  async rerun(ctx, req): Promise<TestResult> {
    await sleep(380, ctx.signal);
    ctx.tool("runner", "Bash", `npx playwright test ${req.testId} --repeat-each=1`);
    const rerun = fx.HEAL_RERUNS[req.testId];
    const title =
      fx.GENERATED.find((t) => t.id === req.testId)?.title ?? req.testId;
    return {
      id: `${req.testId}-${req.attempt}`,
      testId: req.testId,
      title,
      status: req.healed ? "healed" : "failed",
      durationMs: rerun?.durationMs ?? 2_000,
      attempt: req.attempt,
    };
  },

  async assessRisk(ctx): Promise<RiskItem[]> {
    await sleep(400, ctx.signal);
    return fx.RISKS;
  },

  async tracePrd(ctx): Promise<PrdRequirement[] | undefined> {
    if (!ctx.input.prd) return undefined;
    await sleep(300, ctx.signal);
    ctx.tool("orchestrator", "Read", `${ctx.input.prd.filename} — mapping requirements to scenarios`);
    return fx.PRD_TRACE;
  },
};

// ---------------------------------------------------------------------------
// File bodies — real files, so the workspace is genuinely inspectable in Phase 2
// ---------------------------------------------------------------------------

function renderSpec(url: string, scenarios: Scenario[]): string {
  const lines = [`# Test plan — ${url}`, ""];
  for (const [i, s] of scenarios.entries()) {
    lines.push(
      `## ${i + 1}. ${s.title}`,
      "",
      `- **Flow:** ${s.flow}`,
      `- **Kind:** ${s.kind}`,
      `- **Priority:** ${s.priority}`,
      s.addedByCritique ? "- **Added by:** coverage critic" : "",
      "",
      "**Steps**",
      ...s.steps.map((step, j) => `${j + 1}. ${step}`),
      "",
      `**Expected:** ${s.expected}`,
      "",
    );
  }
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

function specFor(test: GeneratedTest): string {
  return `import { test, expect } from "@playwright/test";

// Generated by The Odyssey — ${test.selectorsVerified}/${test.selectorsTotal} locators
// were resolved against the live page before this file was written.
test(${JSON.stringify(test.title)}, async ({ page }) => {
  await page.goto("/");
  // Phase 4 replaces this body with the generator's proven steps.
  await expect(page).toHaveTitle(/./);
});
`;
}

const SEED_SPEC = `import { test as setup } from "@playwright/test";

/** Session bootstrap, per Playwright's own agent file contract. */
setup("authenticate", async ({ page }) => {
  await page.goto("/");
  await page.context().storageState({ path: "results/state.json" });
});
`;
