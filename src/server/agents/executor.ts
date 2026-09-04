/**
 * The Executor — runs the generated suite as a real Playwright suite.
 *
 * There is no model here and no judgment: it shells out, waits, and reports what the
 * runner said. It spends nothing, so it reports no spend.
 *
 * Two things it must get right, both of which were live defects in this repo:
 *
 *   1. **Invoke the project's own runner.** Never bare `npx playwright`. On the machine
 *      this was built on, `npx playwright --version` cheerfully answers `1.62.0` from an
 *      unrelated global conda binary, so a suite shelling out to `npx` works on one
 *      laptop and fails everywhere else. The binary is resolved from the installed
 *      `@playwright/test` package, which is the one the config imports.
 *   2. **Report every generated test.** A file that fails to transpile never reaches the
 *      JSON report at all, so matching results back to what was generated and marking the
 *      unaccounted-for as failures is the only way a broken file shows up as broken
 *      rather than as an absence.
 *
 * The child gets a deliberately minimal environment for the same reason the MCP server
 * does: the model provider key has no business inside a browser the app under test can
 * see.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDir, runPath } from "../paths";
import type { AgentContext } from "../orchestrator/agents";
import type { GeneratedTest, TestResult, TestStatus } from "@/lib/types";

/** Wall-clock ceiling for the whole suite. §7's time guard: a hung suite is a dead demo. */
const SUITE_TIMEOUT_MS = Number(process.env.ODYSSEY_EXECUTE_TIMEOUT_MS ?? 10 * 60_000);

export async function execute(
  ctx: AgentContext,
  req: { tests: GeneratedTest[]; attempt: number },
): Promise<TestResult[]> {
  if (req.tests.length === 0) {
    ctx.tool("runner", "playwright", "No generated tests to run — the suite is empty.", false);
    return [];
  }

  const cli = playwrightCli();
  const args = ["test"];
  // Workers, reporters, headedness and the storage state all live in the generated
  // config, which ships with the suite. Passing them here as well would mean the
  // committed config and the run that produced the report disagree.
  ctx.tool("runner", "Bash", `node ${relativeToProject(cli)} ${args.join(" ")}`);

  const run = await spawnPlaywright(ctx, cli, args);

  if (run.timedOut) {
    ctx.tool("runner", "playwright", `Suite exceeded ${Math.round(SUITE_TIMEOUT_MS / 1000)}s and was terminated.`, false);
  }

  const report = await readReport(ctx);
  if (!report) {
    // No report means the runner never got as far as running anything — a config error,
    // a missing dependency, a transpile failure across the board. The tail of its own
    // output is the most useful thing we have, so it is what gets reported.
    const detail = lastLines(run.stderr || run.stdout, 4) || `exit code ${run.code}`;
    ctx.tool("runner", "playwright", `The runner produced no results.json — ${detail}`, false);
    return req.tests.map((t) => failure(t, req.attempt, `The test runner did not run this file: ${detail}`));
  }

  const workspace = runDir(ctx.runId);
  // Absent `config.rootDir` the report is unreadable anyway; the workspace is the only
  // root left to guess, and it is right whenever Playwright did not move it.
  const rootDir = report.config?.rootDir || workspace;

  const byFile = new Map<string, PwSpec[]>();
  for (const spec of specsIn(report)) {
    const key = keyOf(spec.file, rootDir, workspace);
    const list = byFile.get(key);
    if (list) list.push(spec);
    else byFile.set(key, [spec]);
  }

  const results: TestResult[] = [];
  for (const test of req.tests) {
    // `GeneratedTest.file` is workspace-relative by construction (`generator.ts` writes
    // it as `tests/<slug>.spec.ts`), so the workspace is its root.
    const specs = byFile.get(keyOf(test.file, workspace, workspace));
    if (!specs?.length) {
      const detail =
        report.errors?.map((e) => e.message).find((m) => m?.includes(test.file)) ??
        "It produced no result — the file most likely failed to load.";
      results.push(failure(test, req.attempt, clip(detail)));
      continue;
    }

    // A generated file holds one test, but the report's shape allows several and nothing
    // stops a model writing two. The whole file is the unit here, so they are folded:
    // any failure fails the test, and the durations add up.
    const outcomes = specs.flatMap((s) => s.tests ?? []).flatMap((t) => t.results ?? []);
    const status = foldStatus(outcomes.map((r) => r.status));
    const durationMs = outcomes.reduce((n, r) => n + (r.duration ?? 0), 0);
    const error = outcomes.map((r) => r.error?.message).find(Boolean);

    for (const attachment of outcomes.flatMap((r) => r.attachments ?? [])) {
      const kind = attachmentKind(attachment.name, attachment.contentType);
      if (kind && attachment.path) {
        ctx.artifact(kind, relativeToRun(ctx.runId, attachment.path), `${kind} — ${test.title}`);
      }
    }

    results.push({
      id: `${test.id}-${req.attempt}`,
      testId: test.id,
      title: test.title,
      status,
      durationMs,
      attempt: req.attempt,
      error: error ? clip(stripAnsi(error)) : undefined,
    });
  }

  const passed = results.filter((r) => r.status === "passed").length;
  ctx.tool(
    "runner",
    "playwright",
    `${passed}/${results.length} passed in ${Math.round(run.durationMs / 1000)}s (exit code ${run.code})`,
    passed === results.length,
  );

  return results;
}

// ---------------------------------------------------------------------------
// The child process
// ---------------------------------------------------------------------------

/**
 * The runner that belongs to *this* project.
 *
 * Resolved through the installed package rather than assumed at
 * `<cwd>/node_modules/.bin/playwright`, because pnpm's layout and the dev server's cwd
 * are both things that can move; the package the generated config imports cannot.
 */
function playwrightCli(): string {
  const resolve = createRequire(path.join(process.cwd(), "package.json"));
  const pkg = resolve.resolve("@playwright/test/package.json");
  return path.join(path.dirname(pkg), "cli.js");
}

interface SpawnOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

function spawnPlaywright(ctx: AgentContext, cli: string, args: string[]): Promise<SpawnOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: runDir(ctx.runId),
      env: {
        // Everything the runner needs to find Node, the browsers and nothing else. The
        // provider key in particular stays on this side of the process boundary.
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // Colour codes in an error message end up in the report and then on screen.
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"] as const,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const kill = () => child.kill("SIGTERM");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, SUITE_TIMEOUT_MS);
    ctx.signal.addEventListener("abort", kill, { once: true });

    const finish = (code: number | null) => {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", kill);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started, timedOut });
    };
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on("close", finish);
  });
}

// ---------------------------------------------------------------------------
// The JSON report
// ---------------------------------------------------------------------------

interface PwResultEntry {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: { name?: string; path?: string; contentType?: string }[];
}
interface PwSpec {
  title?: string;
  file?: string;
  tests?: { results?: PwResultEntry[] }[];
}
interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwReport {
  suites?: PwSuite[];
  errors?: { message?: string }[];
  /** `rootDir` is what every `file` in the report is relative to. See `keyOf`. */
  config?: { rootDir?: string };
}

async function readReport(ctx: AgentContext): Promise<PwReport | null> {
  try {
    return JSON.parse(await readFile(runPath(ctx.runId, "results/results.json"), "utf8")) as PwReport;
  } catch {
    return null;
  }
}

function specsIn(report: PwReport): (PwSpec & { file: string })[] {
  const out: (PwSpec & { file: string })[] = [];
  const walk = (suites: PwSuite[] | undefined, inheritedFile: string) => {
    for (const suite of suites ?? []) {
      const file = suite.file ?? inheritedFile;
      for (const spec of suite.specs ?? []) out.push({ ...spec, file: spec.file ?? file });
      walk(suite.suites, file);
    }
  };
  walk(report.suites, "");
  return out;
}

/**
 * One key both sides of the match can be expressed in: the file's path relative to the
 * run workspace.
 *
 * This is not the string tidy-up it looks like. Playwright sets `config.rootDir` to the
 * common ancestor of the test files it collected, and with every generated spec sitting
 * directly in `tests/`, that ancestor is the *tests directory* — so the report calls the
 * file `login.spec.ts` while the run recorded it as `tests/login.spec.ts`. Comparing
 * those as strings matches nothing, and since an unmatched generated test is reported as
 * a failure, a suite that passed every test reports as a suite that failed every test.
 * That is precisely what this did before a real suite was ever run through it.
 *
 * Resolving each side against its own root and re-relativising is the comparison that
 * keeps working when Playwright moves `rootDir` — which it does, silently, whenever the
 * shape of the generated tree changes.
 */
function keyOf(file: string, root: string, workspace: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  return path.relative(workspace, abs).split(path.sep).join("/");
}

/**
 * One status for a file. Anything not green is not green: a run where one of two tests
 * failed is a failed file, and a skip is neither a pass nor a failure.
 */
function foldStatus(statuses: (string | undefined)[]): TestStatus {
  if (!statuses.length) return "failed";
  if (statuses.some((s) => s === "failed" || s === "timedOut" || s === "interrupted")) return "failed";
  if (statuses.every((s) => s === "skipped")) return "pending";
  return statuses.every((s) => s === "passed" || s === "skipped") ? "passed" : "failed";
}

function attachmentKind(
  name: string | undefined,
  contentType: string | undefined,
): "trace" | "video" | "screenshot" | null {
  if (name === "trace") return "trace";
  if (name === "video" || contentType?.startsWith("video/")) return "video";
  if (name === "screenshot" || contentType?.startsWith("image/")) return "screenshot";
  return null;
}

function failure(test: GeneratedTest, attempt: number, error: string): TestResult {
  return {
    id: `${test.id}-${attempt}`,
    testId: test.id,
    title: test.title,
    status: "failed",
    durationMs: 0,
    attempt,
    error,
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const relativeToRun = (runId: string, abs: string) => {
  const rel = path.relative(runDir(runId), abs);
  return rel.startsWith("..") ? abs : rel.replace(/\\/g, "/");
};

const relativeToProject = (abs: string) => path.relative(process.cwd(), abs).replace(/\\/g, "/");

const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

const clip = (s: string, n = 600) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function lastLines(s: string, n: number): string {
  return stripAnsi(s)
    .trimEnd()
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join(" · ")
    .slice(0, 400);
}
