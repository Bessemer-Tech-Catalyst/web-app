/**
 * The Odyssey — core domain + event model.
 *
 * This file is the contract between the orchestrator and the UI. Phase 1 drives the
 * entire UI from a mock emitter that speaks this exact language, so wiring the real
 * orchestrator in Phase 2 is a transport swap with zero UI rework.
 *
 * See docs/IMPLEMENTATION_PLAN.md §5.
 */

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export const STAGES = [
  "recon",
  "plan",
  "critique",
  "generate",
  "execute",
  "triage",
  "heal",
  "report",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<
  Stage,
  { label: string; blurb: string; owner: string }
> = {
  recon: {
    label: "Recon",
    blurb: "Crawl the app, authenticate, map every interactive surface",
    owner: "Recon agent",
  },
  plan: {
    label: "Plan",
    blurb: "Write a human-readable test plan of meaningful user flows",
    owner: "Planner agent",
  },
  critique: {
    label: "Critique",
    blurb: "Grade the plan for coverage gaps — re-plan if it is weak",
    owner: "Orchestrator",
  },
  generate: {
    label: "Generate",
    blurb: "Emit Playwright tests, proving every selector on the live page",
    owner: "Generator agent",
  },
  execute: {
    label: "Execute",
    blurb: "Run the suite in parallel and collect artifacts",
    owner: "Test runner",
  },
  triage: {
    label: "Triage",
    blurb: "Classify each failure: broken script, or a genuine app defect",
    owner: "Orchestrator",
  },
  heal: {
    label: "Heal",
    blurb: "Repair drifted locators — never weaken an assertion",
    owner: "Healer agent",
  },
  report: {
    label: "Report",
    blurb: "Synthesise coverage, outcomes, healer actions and residual risk",
    owner: "Orchestrator",
  },
};

export type StageStatus =
  | "pending"
  | "active"
  | "done"
  | "failed"
  | "skipped";

// ---------------------------------------------------------------------------
// Run input
// ---------------------------------------------------------------------------

export interface RunInput {
  /** The only required input, per the brief. */
  url: string;
  /** Optional natural-language steer, e.g. "focus on checkout and auth". */
  intent?: string;
  /** Optional PRD used to scope the planner and drive gap analysis. */
  prd?: { filename: string; text: string };
  credentials?: { username: string; password: string };
  options: RunOptions;
}

export interface RunOptions {
  maxScenarios: number;
  maxReplans: number;
  maxHealAttemptsPerTest: number;
  parallelWorkers: number;
  headless: boolean;
  budgetUsd: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxScenarios: 18,
  maxReplans: 2,
  maxHealAttemptsPerTest: 2,
  parallelWorkers: 4,
  headless: true,
  budgetUsd: 5,
};

// ---------------------------------------------------------------------------
// Domain objects
// ---------------------------------------------------------------------------

export type Priority = "critical" | "high" | "medium" | "low";
export type ScenarioKind =
  | "happy-path"
  | "negative"
  | "edge-case"
  | "error-state"
  | "permission"
  | "destructive";

export interface Scenario {
  id: string;
  title: string;
  flow: string;
  kind: ScenarioKind;
  priority: Priority;
  steps: string[];
  expected: string;
  /** Set when the critic added this scenario in a re-plan pass. */
  addedByCritique?: boolean;
}

/** A coverage gap found by the Coverage Critic. */
export interface Gap {
  id: string;
  title: string;
  dimension: CritiqueDimension;
  severity: Priority;
  rationale: string;
  /** True once a later plan revision covered it. */
  resolved?: boolean;
}

export type CritiqueDimension =
  | "flow-completeness"
  | "negative-paths"
  | "error-states"
  | "edge-cases"
  | "state-variants"
  | "destructive";

export interface Critique {
  attempt: number;
  score: number; // 0-100
  previousScore?: number;
  dimensions: Record<CritiqueDimension, number>;
  gaps: Gap[];
  verdict: "pass" | "replan";
  rationale: string;
}

export interface GeneratedTest {
  id: string;
  scenarioId: string;
  title: string;
  file: string;
  /** How many locators were resolved against the live page before emitting. */
  selectorsVerified: number;
  selectorsTotal: number;
}

export type TestStatus =
  | "passed"
  | "failed"
  | "healed"
  | "quarantined"
  | "running"
  | "pending";

export interface TestResult {
  id: string;
  testId: string;
  title: string;
  status: TestStatus;
  durationMs: number;
  attempt: number;
  error?: string;
}

// --- Triage -----------------------------------------------------------------

export type TriageVerdict =
  | "SCRIPT_DRIFT"
  | "APP_DEFECT"
  | "ENV_FLAKE"
  | "PLAN_ERROR";

/** Palette tones, mirrored from the UI primitives so this file stays dependency-free. */
export type Tone =
  | "neutral"
  | "ember"
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "violet";

export const TRIAGE_META: Record<
  TriageVerdict,
  { label: string; action: string; tone: Tone }
> = {
  SCRIPT_DRIFT: {
    label: "Script drift",
    action: "Route to Healer",
    tone: "warn",
  },
  APP_DEFECT: {
    label: "Genuine app defect",
    action: "File bug — do not heal",
    tone: "danger",
  },
  ENV_FLAKE: {
    label: "Environment flake",
    action: "Retry once, then reclassify",
    tone: "neutral",
  },
  PLAN_ERROR: {
    label: "Plan error",
    action: "Return to planner backlog",
    tone: "violet",
  },
};

/** A single cited fact backing a decision. Never let the model assert without one. */
export interface Evidence {
  kind:
    | "snapshot-diff"
    | "console-error"
    | "network"
    | "http-status"
    | "selector-provenance"
    | "cross-test"
    | "screenshot"
    | "trace"
    | "assertion-diff"
    | "prd"
    | "heuristic";
  summary: string;
  detail?: string;
}

export interface TriageOutcome {
  testId: string;
  verdict: TriageVerdict;
  confidence: number; // 0-1
  rationale: string;
  evidence: Evidence[];
}

// --- Healing ----------------------------------------------------------------

export interface HealAttempt {
  testId: string;
  attempt: number;
  summary: string;
  before: string;
  after: string;
  /** The assertion-integrity guard. A false here rejects the patch outright. */
  assertionsIntact: boolean;
  outcome: "healed" | "escalated" | "rejected";
}

export interface FiledBug {
  id: string;
  testId: string;
  title: string;
  severity: Priority;
  evidence: Evidence[];
}

// --- Risk -------------------------------------------------------------------

export interface RiskItem {
  id: string;
  surface: string;
  risk: Priority;
  score: number; // 0-100
  reasons: string[];
}

// --- PRD traceability -------------------------------------------------------

export interface PrdRequirement {
  id: string;
  text: string;
  covered: boolean;
  coveredBy: string[];
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------

export interface TestQualityReport {
  runId: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  costUsd: number;

  coverageScore: number;
  scenariosPlanned: number;
  scenariosGenerated: number;
  scenariosQuarantined: number;

  passed: number;
  failed: number;
  healed: number;

  replans: number;
  healAttempts: number;

  scenarios: Scenario[];
  results: TestResult[];
  triage: TriageOutcome[];
  heals: HealAttempt[];
  bugs: FiledBug[];
  remainingGaps: Gap[];
  risks: RiskItem[];
  prd?: PrdRequirement[];
}

// ---------------------------------------------------------------------------
// Event stream — the orchestrator/UI contract
// ---------------------------------------------------------------------------

export type AgentName =
  | "orchestrator"
  | "recon"
  | "planner"
  | "critic"
  | "generator"
  | "runner"
  | "classifier"
  | "healer";

interface EventBase {
  /** Monotonic sequence number — lets the UI resume an SSE stream losslessly. */
  seq: number;
  ts: string;
}

export type OrchestratorEvent = EventBase &
  (
    | { type: "run.started"; runId: string; input: RunInput }
    | { type: "stage.entered"; stage: Stage; attempt: number }
    | {
        type: "stage.exited";
        stage: Stage;
        outcome: "ok" | "replan" | "failed";
        durationMs: number;
      }
    /** The money event. Every judgment the orchestrator makes, with its reasoning. */
    | {
        type: "decision";
        stage: Stage;
        action: string;
        rationale: string;
        confidence: number;
        evidence: Evidence[];
      }
    | { type: "agent.thinking"; agent: AgentName; text: string }
    | {
        type: "agent.tool";
        agent: AgentName;
        tool: string;
        summary: string;
        ok: boolean;
      }
    | {
        type: "artifact";
        kind: "plan" | "test" | "trace" | "screenshot" | "video" | "patch";
        path: string;
        title: string;
      }
    | { type: "recon.ready"; routes: string[]; authenticated: boolean }
    | { type: "plan.ready"; attempt: number; scenarios: Scenario[] }
    | { type: "critique.ready"; critique: Critique }
    | { type: "test.generated"; test: GeneratedTest }
    | { type: "test.result"; result: TestResult }
    | { type: "triage.verdict"; outcome: TriageOutcome }
    | { type: "heal.attempted"; attempt: HealAttempt }
    | { type: "bug.filed"; bug: FiledBug }
    | { type: "cost"; usd: number; tokensIn: number; tokensOut: number }
    | { type: "run.finished"; status: RunStatus; report: TestQualityReport }
    | {
        type: "error";
        stage: Stage;
        message: string;
        recoverable: boolean;
        /** Set when this error ends the run, so the fold knows how it ended. */
        terminal?: RunStatus;
      }
  );

/**
 * `Omit` over a union collapses it to the shared keys, which would erase every
 * event's own fields. Distributing over the union preserves each member.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** An event as an emitter writes it, before `seq` and `ts` are stamped on. */
export type OrchestratorEventInit = DistributiveOmit<OrchestratorEvent, "seq" | "ts">;

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RunSummary {
  id: string;
  url: string;
  status: RunStatus;
  startedAt: string;
  scenarios: number;
  passed: number;
  failed: number;
  coverageScore: number;
}

// ---------------------------------------------------------------------------
// Derived view state — the left-fold of the event log
// ---------------------------------------------------------------------------

export interface RunState {
  runId: string | null;
  input: RunInput | null;
  status: RunStatus;
  /** From the `run.started` event, so elapsed time survives a reload. */
  startedAt: string | null;
  stages: Record<Stage, { status: StageStatus; attempt: number; durationMs?: number }>;
  currentStage: Stage | null;
  decisions: Extract<OrchestratorEvent, { type: "decision" }>[];
  activity: Extract<OrchestratorEvent, { type: "agent.tool" | "agent.thinking" }>[];
  artifacts: Extract<OrchestratorEvent, { type: "artifact" }>[];
  routes: string[];
  authenticated: boolean;
  scenarios: Scenario[];
  critiques: Critique[];
  tests: GeneratedTest[];
  results: Record<string, TestResult>;
  triage: TriageOutcome[];
  heals: HealAttempt[];
  bugs: FiledBug[];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  report: TestQualityReport | null;
  errors: Extract<OrchestratorEvent, { type: "error" }>[];
}

export function emptyRunState(): RunState {
  return {
    runId: null,
    input: null,
    status: "queued",
    startedAt: null,
    stages: Object.fromEntries(
      STAGES.map((s) => [s, { status: "pending" as StageStatus, attempt: 0 }]),
    ) as RunState["stages"],
    currentStage: null,
    decisions: [],
    activity: [],
    artifacts: [],
    routes: [],
    authenticated: false,
    scenarios: [],
    critiques: [],
    tests: [],
    results: {},
    triage: [],
    heals: [],
    bugs: [],
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    report: null,
    errors: [],
  };
}

/**
 * Fold a single event into run state. Pure — the UI reducer, the SSE client and
 * the crash-recovery path all share this one function.
 */
export function reduceRun(state: RunState, ev: OrchestratorEvent): RunState {
  const s = { ...state };
  switch (ev.type) {
    case "run.started":
      return {
        ...s,
        runId: ev.runId,
        input: ev.input,
        status: "running",
        startedAt: ev.ts,
      };

    case "stage.entered":
      return {
        ...s,
        currentStage: ev.stage,
        stages: {
          ...s.stages,
          [ev.stage]: { status: "active", attempt: ev.attempt },
        },
      };

    case "stage.exited":
      return {
        ...s,
        stages: {
          ...s.stages,
          [ev.stage]: {
            ...s.stages[ev.stage],
            status: ev.outcome === "failed" ? "failed" : "done",
            durationMs: ev.durationMs,
          },
        },
      };

    case "decision":
      return { ...s, decisions: [...s.decisions, ev] };

    case "agent.thinking":
    case "agent.tool":
      return { ...s, activity: [...s.activity, ev].slice(-200) };

    case "artifact":
      return { ...s, artifacts: [...s.artifacts, ev] };

    case "recon.ready":
      return { ...s, routes: ev.routes, authenticated: ev.authenticated };

    case "plan.ready":
      return { ...s, scenarios: ev.scenarios };

    case "critique.ready":
      return { ...s, critiques: [...s.critiques, ev.critique] };

    case "test.generated":
      return { ...s, tests: [...s.tests, ev.test] };

    case "test.result":
      return {
        ...s,
        results: { ...s.results, [ev.result.testId]: ev.result },
      };

    case "triage.verdict":
      return { ...s, triage: [...s.triage, ev.outcome] };

    case "heal.attempted":
      return { ...s, heals: [...s.heals, ev.attempt] };

    case "bug.filed":
      return { ...s, bugs: [...s.bugs, ev.bug] };

    case "cost":
      return {
        ...s,
        costUsd: s.costUsd + ev.usd,
        tokensIn: s.tokensIn + ev.tokensIn,
        tokensOut: s.tokensOut + ev.tokensOut,
      };

    case "run.finished":
      return { ...s, status: ev.status, report: ev.report, currentStage: null };

    case "error":
      return {
        ...s,
        errors: [...s.errors, ev],
        status: ev.terminal ?? s.status,
        currentStage: ev.terminal ? null : s.currentStage,
      };

    default:
      return s;
  }
}
