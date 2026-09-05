/**
 * The seam between the orchestrator and the things that do the work.
 *
 * Everything on this interface is *labour* — crawl a page, write a plan, emit a file,
 * run a suite, propose a patch. Everything that is *judgment* — whether the plan is
 * good enough, whether a failure is the app's fault, whether a patch is honest, when
 * to stop — stays in the FSM. That split is the whole thesis of the product, so it is
 * worth keeping legible in the type system.
 *
 * Phase 2 ships `stubAgents`. Phases 3–6 swap in Agent SDK implementations one method
 * at a time; the FSM above them does not change.
 */

import type {
  AgentName,
  Critique,
  Evidence,
  GeneratedTest,
  Gap,
  PrdRequirement,
  RiskItem,
  RunInput,
  Scenario,
  TestResult,
  TriageOutcome,
} from "@/lib/types";
import type { HealProposal } from "./fixtures";

export interface AgentContext {
  runId: string;
  input: RunInput;
  /** Absolute path to this run's workspace. Agents write real files here. */
  workspace: string;
  signal: AbortSignal;
  /** Narration — what the agent is about to do and why. */
  think(agent: AgentName, text: string): void;
  /**
   * A tool call the agent made, with its outcome. `detail` is the unsqueezed version of
   * the same call — the arguments in full, or a failure's own reply — for the console row
   * a reader opens; see the event in `types.ts`.
   */
  tool(
    agent: AgentName,
    tool: string,
    summary: string,
    ok?: boolean,
    detail?: string,
  ): void;
  /** A file the agent produced. `testId` ties it to one generated test, when it is one. */
  artifact(
    kind: "plan" | "test" | "trace" | "screenshot" | "video" | "patch",
    path: string,
    title: string,
    testId?: string,
  ): void;
  /** Token spend, reported per stage so the budget guard can act mid-run. */
  spend(usd: number, tokensIn: number, tokensOut: number): void;
  /**
   * Whether this run has passed the budget ceiling its caller set.
   *
   * A stage that spends per unit of work — the Generator runs one agent per scenario —
   * has to ask, because nothing else can stop it partway. Without this the ceiling only
   * governed re-planning and healing, so a run could sail past a $3 limit inside the one
   * stage that accounts for most of the bill, while the Decision Log said it had
   * "degraded gracefully rather than pressing on".
   */
  overBudget(): boolean;
}

export interface ReconResult {
  routes: string[];
  authenticated: boolean;
  /** Surfaces recon proved exist — the critic scores the plan against these. */
  evidence: Evidence[];
}

export interface PlanRequest {
  attempt: number;
  /** Present from attempt 2 onward: the exact gaps the plan must close. */
  directives: Gap[];
  previous?: Scenario[];
}

export interface GenerateResult {
  tests: GeneratedTest[];
  /** Scenarios held back because a locator could not be proven on the live page. */
  quarantined: { scenarioId: string; title: string; reason: string }[];
}

export interface Agents {
  recon(ctx: AgentContext): Promise<ReconResult>;
  plan(ctx: AgentContext, req: PlanRequest): Promise<Scenario[]>;
  critique(
    ctx: AgentContext,
    req: { attempt: number; scenarios: Scenario[]; recon: ReconResult },
  ): Promise<Critique>;
  generate(
    ctx: AgentContext,
    req: { scenarios: Scenario[] },
  ): Promise<GenerateResult>;
  execute(
    ctx: AgentContext,
    req: { tests: GeneratedTest[]; attempt: number },
  ): Promise<TestResult[]>;
  /** Assembles an evidence bundle per failure and classifies it. */
  triage(
    ctx: AgentContext,
    req: { failures: TestResult[] },
  ): Promise<TriageOutcome[]>;
  /** Proposes a patch. The orchestrator decides whether it is allowed to land. */
  proposeHeal(
    ctx: AgentContext,
    req: { testId: string; attempt: number; triage: TriageOutcome },
  ): Promise<HealProposal | null>;
  /** Re-runs one test after an accepted patch, or after a suspected flake. */
  rerun(
    ctx: AgentContext,
    req: { testId: string; attempt: number; healed: boolean },
  ): Promise<TestResult>;
  /**
   * Scores the surfaces we found but never covered.
   *
   * `results` is passed in rather than read back off disk because this runs *inside* the
   * report stage — `report.json` does not exist yet, and a ledger that quietly read an
   * empty results file would rank every surface as untested and be completely wrong in a
   * way that looks completely normal.
   */
  assessRisk(
    ctx: AgentContext,
    req: {
      recon: ReconResult;
      scenarios: Scenario[];
      /** Held-back scenarios with the reason, carried from `GenerateResult`. */
      quarantined: { scenarioId: string; reason: string }[];
      results: TestResult[];
      /**
       * The emitted suite. Carried so coverage can be read off the files the Generator
       * actually wrote, rather than off filenames reconstructed from scenario ids.
       */
      tests: GeneratedTest[];
    },
  ): Promise<RiskItem[]>;
  /**
   * Maps PRD requirements onto the scenarios that cover them.
   *
   * Takes `results` for the same reason, and for a sharper one: a requirement is only
   * covered if a test that *ran* stands behind it. Without the results this could only
   * report which requirements the plan mentions, which is the fake version of this
   * feature.
   */
  tracePrd(
    ctx: AgentContext,
    req: { scenarios: Scenario[]; results: TestResult[] },
  ): Promise<PrdRequirement[] | undefined>;
}
