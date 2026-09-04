"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActivityFeed } from "@/components/console/activity-feed";
import { CritiquePanel } from "@/components/console/critique-panel";
import { DecisionLog } from "@/components/console/decision-log";
import { StagePipeline } from "@/components/console/stage-pipeline";
import { TestBoard } from "@/components/console/test-board";
import { Badge, Card, CardHeader, Dot, Empty } from "@/components/ui/primitives";
import { useRunStream, type Speed } from "@/hooks/use-run-stream";
import { cn, formatDuration, formatTokens, formatUsd, hostOf } from "@/lib/format";
import { loadDraft } from "@/lib/run-draft";
import { DEFAULT_RUN_OPTIONS, STAGE_META, type RunInput } from "@/lib/types";
import { MOCK_TARGET_URL } from "@/lib/mock-run";

export function RunConsole({ runId }: { runId: string }) {
  const [input, setInput] = useState<RunInput | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<"suite" | "activity" | "artifacts">("suite");

  useEffect(() => {
    setInput(
      loadDraft(runId) ?? {
        url: MOCK_TARGET_URL,
        intent: "focus on checkout and authentication flows",
        options: DEFAULT_RUN_OPTIONS,
      },
    );
  }, [runId]);

  const { state, speed, setSpeed, done, skipToEnd } = useRunStream(runId, input);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, [done]);

  const budgetPct = useMemo(
    () =>
      input ? Math.min(100, (state.costUsd / input.options.budgetUsd) * 100) : 0,
    [state.costUsd, input],
  );

  if (!input) return null;

  const running = state.status === "running";

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* ---------- top bar ---------- */}
      <header className="shrink-0 border-b border-base-850 bg-base-950/80 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            href="/runs"
            className="rounded-md border border-base-800 px-2.5 py-1 text-xs text-base-400 transition hover:border-base-700 hover:text-base-100"
          >
            ← Runs
          </Link>

          <div className="flex min-w-0 items-center gap-2 border-l border-base-800 pl-4">
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

            <div className="flex items-center gap-0.5 rounded-lg border border-base-800 bg-base-900 p-0.5">
              {([1, 2, 4] as Speed[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  aria-pressed={speed === s}
                  className={cn(
                    "rounded px-2 py-1 font-mono text-[11px] transition",
                    speed === s
                      ? "bg-base-800 text-base-100"
                      : "text-base-500 hover:text-base-300",
                  )}
                >
                  {s}×
                </button>
              ))}
              <button
                onClick={skipToEnd}
                disabled={done}
                className="rounded px-2 py-1 font-mono text-[11px] text-base-500 transition hover:text-base-300 disabled:opacity-40"
                title="Fast-forward to the end"
              >
                ⏭
              </button>
            </div>

            {state.report ? (
              <Link
                href={`/runs/${runId}/report`}
                className="rounded-lg bg-ember-500 px-3.5 py-1.5 text-xs font-semibold text-base-950 transition hover:bg-ember-400"
              >
                View report →
              </Link>
            ) : null}
          </div>
        </div>

        <div className="border-t border-base-850 px-3">
          <StagePipeline state={state} />
        </div>
      </header>

      {/* ---------- body ---------- */}
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <DecisionLog decisions={state.decisions} />
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <CritiquePanel critiques={state.critiques} />

          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex shrink-0 gap-1">
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

            <div className="min-h-0 flex-1">
              {tab === "suite" && (
                <TestBoard
                  tests={state.tests}
                  results={state.results}
                  triage={state.triage}
                  heals={state.heals}
                />
              )}
              {tab === "activity" && <ActivityFeed activity={state.activity} />}
              {tab === "artifacts" && <ArtifactRail artifacts={state.artifacts} />}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- status strip ---------- */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-base-850 bg-base-950/80 px-4 py-2 text-[11px] text-base-500 backdrop-blur">
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
    <div className="rounded-lg border border-base-800 bg-base-900 px-2.5 py-1">
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
  artifacts,
}: {
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
    <Card className="flex min-h-0 flex-col">
      <CardHeader
        title="Artifacts"
        subtitle="Real files on disk — commit them, open them in the Playwright viewer"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {artifacts.length === 0 ? (
          <Empty>Nothing written yet</Empty>
        ) : (
          <ul className="divide-y divide-base-850">
            {artifacts.map((a) => (
              <li
                key={a.seq}
                className="animate-stream-in flex items-center gap-2.5 px-4 py-2"
              >
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded border border-base-800 bg-base-850 font-mono text-[10px] text-base-400"
                >
                  {ICON[a.kind] ?? "·"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-base-200">{a.title}</p>
                  <p className="truncate font-mono text-[10px] text-base-600">{a.path}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
