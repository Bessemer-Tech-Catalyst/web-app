/**
 * Phase 1 fixtures for everything outside a single run: the target registry, the
 * schedule, run history, cross-run defects and coverage. Same shape the Phase 2
 * API will return, so the pages swap a fetch in and keep their markup.
 */

import type { Priority, RunStatus } from "./types";

const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface Target {
  id: string;
  name: string;
  url: string;
  env: "production" | "staging" | "local";
  authed: boolean;
  prd?: string;
  routes: number;
  lastRunAt: string;
  coverageScore: number;
  trend: number;
}

export const TARGETS: Target[] = [
  {
    id: "tgt_shoplite",
    name: "ShopLite",
    url: "https://shoplite.demo",
    env: "staging",
    authed: true,
    prd: "shoplite-prd-v3.md",
    routes: 24,
    lastRunAt: new Date(Date.now() - minutes(42)).toISOString(),
    coverageScore: 88,
    trend: +6,
  },
  {
    id: "tgt_todomvc",
    name: "TodoMVC",
    url: "https://demo.playwright.dev/todomvc",
    env: "production",
    authed: false,
    routes: 3,
    lastRunAt: new Date(Date.now() - hours(3)).toISOString(),
    coverageScore: 91,
    trend: +1,
  },
  {
    id: "tgt_saucedemo",
    name: "SauceDemo",
    url: "https://www.saucedemo.com",
    env: "production",
    authed: true,
    routes: 7,
    lastRunAt: new Date(Date.now() - hours(26)).toISOString(),
    coverageScore: 74,
    trend: -5,
  },
  {
    id: "tgt_localdash",
    name: "Internal dashboard",
    url: "http://localhost:3000",
    env: "local",
    authed: true,
    prd: "dashboard-requirements.md",
    routes: 12,
    lastRunAt: new Date(Date.now() - hours(52)).toISOString(),
    coverageScore: 63,
    trend: 0,
  },
];

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface Schedule {
  id: string;
  name: string;
  targetId: string;
  cron: string;
  cadence: string;
  nextRunAt: string;
  enabled: boolean;
  intent?: string;
  lastStatus: RunStatus;
  lastRunId?: string;
  scenarios: number;
  avgDurationMs: number;
}

export const SCHEDULES: Schedule[] = [
  {
    id: "sch_nightly",
    name: "Nightly full sweep",
    targetId: "tgt_shoplite",
    cron: "0 2 * * *",
    cadence: "Every day at 02:00",
    nextRunAt: new Date(Date.now() + hours(9)).toISOString(),
    enabled: true,
    intent: "cover everything — no scope narrowing",
    lastStatus: "succeeded",
    lastRunId: "run_8f2a41",
    scenarios: 18,
    avgDurationMs: 512_000,
  },
  {
    id: "sch_checkout",
    name: "Checkout smoke",
    targetId: "tgt_shoplite",
    cron: "0 */4 * * *",
    cadence: "Every 4 hours",
    nextRunAt: new Date(Date.now() + minutes(96)).toISOString(),
    enabled: true,
    intent: "focus on checkout and payment failure states",
    lastStatus: "succeeded",
    lastRunId: "run_2b77c1",
    scenarios: 6,
    avgDurationMs: 141_000,
  },
  {
    id: "sch_auth",
    name: "Auth regression",
    targetId: "tgt_saucedemo",
    cron: "30 6 * * 1-5",
    cadence: "Weekdays at 06:30",
    nextRunAt: new Date(Date.now() + hours(17)).toISOString(),
    enabled: true,
    intent: "login, lockout, session expiry, password reset",
    lastStatus: "failed",
    lastRunId: "run_5d9e77",
    scenarios: 9,
    avgDurationMs: 233_000,
  },
  {
    id: "sch_weekly",
    name: "Weekly PRD gap audit",
    targetId: "tgt_localdash",
    cron: "0 8 * * 1",
    cadence: "Mondays at 08:00",
    nextRunAt: new Date(Date.now() + hours(74)).toISOString(),
    enabled: false,
    lastStatus: "succeeded",
    scenarios: 14,
    avgDurationMs: 388_000,
  },
];

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------

export interface RunHistoryEntry {
  id: string;
  targetId: string;
  url: string;
  status: RunStatus;
  trigger: "manual" | "schedule";
  scheduleId?: string;
  startedAt: string;
  durationMs: number;
  scenarios: number;
  passed: number;
  failed: number;
  healed: number;
  bugs: number;
  replans: number;
  coverageScore: number;
  costUsd: number;
  intent?: string;
}

export const RUN_HISTORY: RunHistoryEntry[] = [
  {
    id: "run_8f2a41",
    targetId: "tgt_shoplite",
    url: "https://shoplite.demo",
    status: "succeeded",
    trigger: "manual",
    startedAt: new Date(Date.now() - minutes(42)).toISOString(),
    durationMs: 498_000,
    scenarios: 15,
    passed: 12,
    failed: 2,
    healed: 3,
    bugs: 2,
    replans: 1,
    coverageScore: 88,
    costUsd: 2.41,
    intent: "focus on checkout and authentication flows",
  },
  {
    id: "run_2b77c1",
    targetId: "tgt_shoplite",
    url: "https://shoplite.demo",
    status: "succeeded",
    trigger: "schedule",
    scheduleId: "sch_checkout",
    startedAt: new Date(Date.now() - hours(2)).toISOString(),
    durationMs: 138_000,
    scenarios: 6,
    passed: 6,
    failed: 0,
    healed: 1,
    bugs: 0,
    replans: 0,
    coverageScore: 82,
    costUsd: 0.74,
    intent: "focus on checkout and payment failure states",
  },
  {
    id: "run_7c1b09",
    targetId: "tgt_todomvc",
    url: "https://demo.playwright.dev/todomvc",
    status: "succeeded",
    trigger: "manual",
    startedAt: new Date(Date.now() - hours(3)).toISOString(),
    durationMs: 96_000,
    scenarios: 11,
    passed: 11,
    failed: 0,
    healed: 0,
    bugs: 0,
    replans: 0,
    coverageScore: 91,
    costUsd: 0.52,
  },
  {
    id: "run_5d9e77",
    targetId: "tgt_saucedemo",
    url: "https://www.saucedemo.com",
    status: "failed",
    trigger: "schedule",
    scheduleId: "sch_auth",
    startedAt: new Date(Date.now() - hours(26)).toISOString(),
    durationMs: 241_000,
    scenarios: 9,
    passed: 6,
    failed: 3,
    healed: 1,
    bugs: 2,
    replans: 2,
    coverageScore: 74,
    costUsd: 1.88,
    intent: "login, lockout, session expiry, password reset",
  },
  {
    id: "run_1a44e2",
    targetId: "tgt_shoplite",
    url: "https://shoplite.demo",
    status: "succeeded",
    trigger: "schedule",
    scheduleId: "sch_nightly",
    startedAt: new Date(Date.now() - hours(31)).toISOString(),
    durationMs: 524_000,
    scenarios: 18,
    passed: 16,
    failed: 1,
    healed: 4,
    bugs: 1,
    replans: 1,
    coverageScore: 86,
    costUsd: 3.12,
  },
  {
    id: "run_9e30bb",
    targetId: "tgt_localdash",
    url: "http://localhost:3000",
    status: "cancelled",
    trigger: "manual",
    startedAt: new Date(Date.now() - hours(52)).toISOString(),
    durationMs: 61_000,
    scenarios: 14,
    passed: 4,
    failed: 0,
    healed: 0,
    bugs: 0,
    replans: 0,
    coverageScore: 63,
    costUsd: 0.31,
    intent: "admin permissions only",
  },
];

/** Precomputed at module load — pages must stay pure at render time. */
export const RUNS_LAST_24H = RUN_HISTORY.filter(
  (r) => Date.now() - new Date(r.startedAt).getTime() < 24 * 3_600_000,
);

// ---------------------------------------------------------------------------
// Cross-run defects
// ---------------------------------------------------------------------------

export interface FleetDefect {
  id: string;
  title: string;
  targetId: string;
  runId: string;
  severity: Priority;
  confidence: number;
  status: "open" | "triaged" | "fixed";
  surface: string;
  evidence: string;
  firstSeenAt: string;
  occurrences: number;
}

export const DEFECTS: FleetDefect[] = [
  {
    id: "bug_401",
    title: "Coupon stacking lets order total go negative",
    targetId: "tgt_shoplite",
    runId: "run_8f2a41",
    severity: "critical",
    confidence: 0.94,
    status: "open",
    surface: "/checkout",
    evidence: "Total rendered −$4.50 after two SAVE20 applications; no server error",
    firstSeenAt: new Date(Date.now() - minutes(42)).toISOString(),
    occurrences: 3,
  },
  {
    id: "bug_402",
    title: "Session survives logout in a second tab",
    targetId: "tgt_saucedemo",
    runId: "run_5d9e77",
    severity: "high",
    confidence: 0.88,
    status: "triaged",
    surface: "/inventory.html",
    evidence: "GET /inventory returned 200 with a revoked session cookie",
    firstSeenAt: new Date(Date.now() - hours(26)).toISOString(),
    occurrences: 2,
  },
  {
    id: "bug_403",
    title: "Out-of-stock item still addable from search results",
    targetId: "tgt_shoplite",
    runId: "run_1a44e2",
    severity: "high",
    confidence: 0.81,
    status: "open",
    surface: "/search",
    evidence: "POST /cart 201 for SKU flagged stock:0 in the product payload",
    firstSeenAt: new Date(Date.now() - hours(31)).toISOString(),
    occurrences: 1,
  },
  {
    id: "bug_404",
    title: "Password reset accepts an expired token",
    targetId: "tgt_saucedemo",
    runId: "run_5d9e77",
    severity: "critical",
    confidence: 0.79,
    status: "open",
    surface: "/reset",
    evidence: "Token issued 8 days prior still returned a 302 to the success page",
    firstSeenAt: new Date(Date.now() - hours(26)).toISOString(),
    occurrences: 1,
  },
];

// ---------------------------------------------------------------------------
// Coverage — what the fleet has and hasn't tested
// ---------------------------------------------------------------------------

export interface CoverageSurface {
  id: string;
  surface: string;
  targetId: string;
  scenarios: number;
  passRate: number;
  risk: Priority;
  note: string;
}

export const COVERAGE: CoverageSurface[] = [
  {
    id: "cov_checkout",
    surface: "Checkout & payment",
    targetId: "tgt_shoplite",
    scenarios: 9,
    passRate: 0.89,
    risk: "low",
    note: "Card decline, 3DS challenge and coupon edge cases all exercised",
  },
  {
    id: "cov_auth",
    surface: "Authentication",
    targetId: "tgt_shoplite",
    scenarios: 7,
    passRate: 1,
    risk: "low",
    note: "Lockout and session expiry covered; SSO path still untested",
  },
  {
    id: "cov_admin",
    surface: "Admin — refunds",
    targetId: "tgt_shoplite",
    scenarios: 1,
    passRate: 0,
    risk: "critical",
    note: "Destructive surface behind a role the planner never obtained",
  },
  {
    id: "cov_profile",
    surface: "Account & profile",
    targetId: "tgt_shoplite",
    scenarios: 3,
    passRate: 0.67,
    risk: "medium",
    note: "Address book covered; payment-method deletion not reached",
  },
  {
    id: "cov_search",
    surface: "Search & filters",
    targetId: "tgt_shoplite",
    scenarios: 4,
    passRate: 0.75,
    risk: "medium",
    note: "Empty-state and pagination boundaries untested",
  },
  {
    id: "cov_i18n",
    surface: "Locale & currency",
    targetId: "tgt_shoplite",
    scenarios: 0,
    passRate: 0,
    risk: "high",
    note: "Never planned — no scenario has switched locale",
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function targetById(id: string): Target | undefined {
  return TARGETS.find((t) => t.id === id);
}

export function targetName(id: string): string {
  return targetById(id)?.name ?? id;
}

export function scheduleById(id: string): Schedule | undefined {
  return SCHEDULES.find((s) => s.id === id);
}

export function formatCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
  return `in ${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
