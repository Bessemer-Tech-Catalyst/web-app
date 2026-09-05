"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActivityFeed } from "@/components/console/activity-feed";
import { CritiquePanel } from "@/components/console/critique-panel";
import { DecisionLog } from "@/components/console/decision-log";
import { StagePipeline } from "@/components/console/stage-pipeline";
import { TestBoard } from "@/components/console/test-board";
import { Badge, Section, SectionHeader, Dot, Empty } from "@/components/ui/primitives";
import { useRunStream } from "@/hooks/use-run-stream";
import { cn, formatDuration, formatTokens, formatUsd, hostOf } from "@/lib/format";
import { cancelRun } from "@/lib/run-client";
import { STAGE_META } from "@/lib/types";

export function RunConsole({ runId }: { runId: string }) {
  const [tab, setTab] = useState<"suite" | "activity" | "artifacts">("suite");
  const [cancelling, setCancelling] = useState(false);

  const { state, status, done } = useRunStream(runId);
  const input = state.input;

  // Elapsed is measured from the run's own first event, not from when this tab
  // opened, so a reload mid-run shows the true clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [done]);

  const elapsed = state.report
    ? state.report.durationMs
    : state.startedAt
      ? Math.max(0, now - Date.parse(state.startedAt))
      : 0;

  const budgetPct = useMemo(
    () =>
      input ? Math.min(100, (state.costUsd / input.options.budgetUsd) * 100) : 0,
    [state.costUsd, input],
  );

  if (!input) {
    return (
      <main className="flex h-full items-center justify-center px-6">
        <p className="text-sm text-base-500">
          {status === "error"
            ? "Lost the connection to this run — retrying…"
            : "Connecting to the run stream…"}
        </p>
      </main>
    );
  }

  const running = state.status === "running" && !done;

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* ---------- top bar ---------- */}
      <header className="shrink-0 border-b border-base-850 bg-base-950/80 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3.5">
          <Link
            href="/runs"
            className="rounded-md border border-base-800 px-2.5 py-1 text-xs text-base-400 transition hover:border-base-700 hover:text-base-100"
          >
            ← Runs
          </Link>

          <div className="flex min-w-0 items-center gap-2 border-l border-base-850 pl-4">
            <Dot tone={running ? "ember" : state.report ? "ok" : "neutral"} pulse={running} />
            <span className="truncate font-mono text-xs text-base-300">
              {hostOf(input.url)}
            </span>
            <Badge mono>{runId}</Badge>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Metric label="elapsed" value={formatDuration(elapsed)} />
            <Metric
              label="spend"
              value={formatUsd(state.costUsd)}
              hint={`of ${formatUsd(input.options.budgetUsd)}`}
              warn={budgetPct > 80}
            />
            <Metric
              label="tokens"
              value={`${formatTokens(state.tokensIn)}/${formatTokens(state.tokensOut)}`}
            />

            <span
              className="flex items-center gap-1.5 rounded-md border border-base-800 bg-base-900 px-2.5 py-1.5 text-[11px] text-base-400"
              title={`Event stream: ${status}`}
            >
              <Dot
                tone={status === "live" ? "ok" : status === "ended" ? "neutral" : "warn"}
                pulse={status === "live" && running}
              />
              {status === "live" ? "streaming" : status === "ended" ? "stream closed" : "reconnecting"}
            </span>

            {running ? (
              <button
                onClick={() => {
                  setCancelling(true);
                  void cancelRun(runId);
                }}
                disabled={cancelling}
                className="rounded-md border border-base-800 px-2.5 py-1.5 text-[11px] text-base-400 transition hover:border-danger-500/60 hover:text-danger-400 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            ) : null}

            {state.report ? (
              <Link
                href={`/runs/${runId}/report`}
                className="rounded-md bg-ember-500 px-3.5 py-1.5 text-xs font-semibold text-base-950 transition hover:bg-ember-400"
              >
                View report →
              </Link>
            ) : null}
          </div>
        </div>

        <div className="border-t border-base-850">
          <StagePipeline state={state} />
        </div>
      </header>

      {/* ---------- body ---------- */}
      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-b border-base-850 lg:border-b-0 lg:border-r">
          <DecisionLog decisions={state.decisions} />
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] divide-y divide-base-850">
          <CritiquePanel critiques={state.critiques} />

          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 gap-1 border-b border-base-850 px-4 py-2.5">
              {(
                [
                  ["suite", `Suite ${state.tests.length ? `(${state.tests.length})` : ""}`],
                  ["activity", "Activity"],
                  ["artifacts", `Artifacts ${state.artifacts.length ? `(${state.artifacts.length})` : ""}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition",
                    tab === key
                      ? "border-base-700 bg-base-850 text-base-100"
                      : "border-transparent text-base-500 hover:text-base-300",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* A flex *container*, not just a flex item. Each panel below is
                `flex min-h-0 flex-col` with a scrolling body, and that only bounds itself
                if its parent establishes the height — as a plain block this div sized to
                its content, so the feed clipped at the panel edge instead of scrolling. */}
            <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
              {tab === "suite" && (
                <TestBoard
                  runId={runId}
                  tests={state.tests}
                  results={state.results}
                  triage={state.triage}
                  heals={state.heals}
                  artifacts={state.artifacts}
                />
              )}
              {tab === "activity" && <ActivityFeed activity={state.activity} />}
              {tab === "artifacts" && (
                <ArtifactRail runId={runId} artifacts={state.artifacts} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- status strip ---------- */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-base-850 bg-base-950/80 px-6 py-2.5 text-[11px] text-base-500 backdrop-blur">
        {running && state.currentStage ? (
          <>
            <Dot tone="ember" pulse />
            <span className="text-base-300">
              {STAGE_META[state.currentStage].label}
            </span>
            <span className="truncate">{STAGE_META[state.currentStage].blurb}</span>
          </>
        ) : state.report ? (
          <>
            <Dot tone="ok" />
            <span className="text-base-300">Run complete</span>
            <span>
              {state.report.passed} passed · {state.report.healed} healed ·{" "}
              {state.report.failed} failed · {state.report.bugs.length} bugs filed ·
              coverage {state.report.coverageScore}/100
            </span>
          </>
        ) : state.errors.length ? (
          <>
            <Dot tone="danger" />
            <span className="text-base-300">
              {state.status === "cancelled" ? "Run cancelled" : "Run failed"}
            </span>
            <span className="truncate">{state.errors.at(-1)?.message}</span>
          </>
        ) : (
          <>
            <Dot />
            <span>Initialising…</span>
          </>
        )}
        <span className="ml-auto shrink-0 font-mono text-base-700">
          {state.routes.length ? `${state.routes.length} routes mapped` : ""}
        </span>
      </footer>
    </main>
  );
}

function Metric({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-base-800 bg-base-900 px-2.5 py-1">
      <div className="text-[9px] uppercase tracking-wider text-base-600">{label}</div>
      <div
        className={cn(
          "font-mono text-xs tabular-nums",
          warn ? "text-warn-500" : "text-base-200",
        )}
      >
        {value}
        {hint ? <span className="ml-1 text-base-600">{hint}</span> : null}
      </div>
    </div>
  );
}

function ArtifactRail({
  runId,
  artifacts,
}: {
  runId: string;
  artifacts: { seq: number; kind: string; path: string; title: string }[];
}) {
  const ICON: Record<string, string> = {
    plan: "§",
    test: "⌗",
    trace: "≡",
    screenshot: "▢",
    video: "▷",
    patch: "±",
  };
  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title="Artifacts"
        subtitle="Real files on disk — commit them, open them in the Playwright viewer"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {artifacts.length === 0 ? (
          <Empty>Nothing written yet</Empty>
        ) : (
          <ul className="divide-y divide-base-850">
            {artifacts.map((a) => (
              <li key={a.seq} className="animate-stream-in">
                {/* Openable, not merely named. A run writes real files and a rail that
                    only lists their paths is describing evidence rather than showing it. */}
                <a
                  href={`/api/runs/${runId}/artifacts/${a.path.split("/").map(encodeURIComponent).join("/")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 px-6 py-2 transition hover:bg-base-900/60"
                >
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded bg-base-850 font-mono text-[10px] text-base-400"
                  >
                    {ICON[a.kind] ?? "·"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-base-200">{a.title}</p>
                    <p className="truncate font-mono text-[10px] text-base-600">{a.path}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
