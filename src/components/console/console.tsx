"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityFeed } from "@/components/console/activity-feed";
import { CritiquePanel, scoreTone } from "@/components/console/critique-panel";
import { DecisionLog } from "@/components/console/decision-log";
import { MarkdownSheet } from "@/components/console/markdown-view";
import { StagePipeline } from "@/components/console/stage-pipeline";
import { TestBoard } from "@/components/console/test-board";
import { Section, SectionHeader, Dot, Empty } from "@/components/ui/primitives";
import { useRunStream } from "@/hooks/use-run-stream";
import { cn, formatDuration, formatTokens, formatUsd, hostOf } from "@/lib/format";
import { cancelRun } from "@/lib/run-client";
import { STAGE_META, type RunState } from "@/lib/types";

export function RunConsole({ runId }: { runId: string }) {
  // Activity is the default because it is the only panel with anything in it from the
  // first second of a run: the suite stays empty until the Generator writes a file and the
  // rail until something is on disk, so opening on either shows a placeholder through the
  // half of the run a watcher most wants to see moving.
  const [tab, setTab] = useState<Tab>("activity");
  const [leftTab, setLeftTab] = useState<LeftTab>("decisions");
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
        <p className="text-body text-base-400">
          {status === "error"
            ? "Lost the connection to this run — retrying…"
            : "Connecting to the run stream…"}
        </p>
      </main>
    );
  }

  const running = state.status === "running" && !done;

  return (
    <main className="console-ground flex h-full flex-col overflow-hidden">
      {/* ---------- top bar ---------- */}
      <header className="shrink-0 border-b border-base-800 bg-base-950">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3">
          <Link
            href="/runs"
            className="rounded-md border border-base-800 px-2.5 py-1.5 text-detail font-medium text-base-400 transition hover:border-base-700 hover:bg-base-900 hover:text-base-100"
          >
            ← Runs
          </Link>

          {/* Which run this is, said once and said plainly. The id is the thing a
              watcher reads aloud to someone else, so it is the larger of the two. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <Dot tone={running ? "ember" : state.report ? "ok" : "neutral"} pulse={running} />
            <span className="truncate font-mono text-body font-medium text-base-100">
              {runId}
            </span>
            <span className="truncate font-mono text-meta text-base-500">
              {hostOf(input.url)}
            </span>
          </div>

          {/* One instrument cluster, not four floating chips. The readouts share a
              frame and are told apart by a hairline, the way they would be on a panel. */}
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <div className="flex items-stretch divide-x divide-base-800 overflow-hidden rounded-lg border border-base-800 bg-base-900">
              <Metric label="Elapsed" value={formatDuration(elapsed)} />
              <Metric
                label="Spend"
                value={formatUsd(state.costUsd)}
                hint={`of ${formatUsd(input.options.budgetUsd)}`}
                warn={budgetPct > 80}
              />
              <Metric
                label="Tokens"
                value={`${formatTokens(state.tokensIn)}/${formatTokens(state.tokensOut)}`}
              />
            </div>

            <span
              className="flex items-center gap-1.5 rounded-lg border border-base-800 bg-base-900 px-2.5 py-2 text-meta font-medium text-base-500"
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
                className="rounded-lg border border-base-800 px-3 py-2 text-meta font-medium text-base-400 transition hover:border-danger-500/60 hover:text-danger-400 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            ) : null}

            {state.report ? (
              <Link
                href={`/runs/${runId}/report`}
                className="rounded-lg bg-ember-500 px-4 py-2 text-detail font-semibold text-base-950 transition hover:bg-ember-400"
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
      {/* Two columns, divided by *kind*: on the left the run's reasoning — what it
          decided, and how its own critic graded the plan; on the right the material that
          reasoning produced — the raw feed, the suite, the files. Each side pages through
          its panels with the same strip.

          Below lg the two stack and the page scrolls, each keeping a bounded height of
          its own: a 200-row agent feed unrolled into the document would bury the decision
          log under it and take its tail-following with it. */}
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:overflow-hidden">
        {/* What the run decided, and the grade the critic gave the plan it decided on.
            Both are the run arguing with itself, so they are peers behind one strip
            rather than one panel with the other wedged under it — which gave the critic
            a third of the column whether it had a breakdown to show or the single
            sentence "the plan has not been graded yet". */}
        <div className="flex h-[34rem] min-h-0 flex-col border-b border-base-850 lg:h-auto lg:border-b-0 lg:border-r">
          <TabStrip
            tabs={[
              { key: "decisions", label: "Decisions", readout: state.decisions.length },
              { key: "critic", label: "Critic", ...criticReadout(state) },
            ]}
            value={leftTab}
            onChange={setLeftTab}
          />
          <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
            {leftTab === "decisions" && <DecisionLog decisions={state.decisions} />}
            {leftTab === "critic" && <CritiquePanel critiques={state.critiques} />}
          </div>
        </div>

        <div className="flex h-[34rem] min-h-0 flex-col lg:h-auto">
          <TabStrip
            tabs={TABS.map((t) => ({ ...t, readout: tabCount(t.key, state) }))}
            value={tab}
            onChange={setTab}
          />

          {/* A flex *container*, not just a flex item. Each panel below is
              `flex min-h-0 flex-col` with a scrolling body, and that only bounds itself
              if its parent establishes the height — as a plain block this div sized to
              its content, so the feed clipped at the panel edge instead of scrolling. */}
          <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
            {tab === "activity" && <ActivityFeed activity={state.activity} />}
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
            {tab === "artifacts" && (
              <ArtifactRail runId={runId} artifacts={state.artifacts} />
            )}
          </div>
        </div>
      </div>

      {/* ---------- status strip ---------- */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-base-800 bg-base-900 px-6 py-2.5 text-detail text-base-500">
        {running && state.currentStage ? (
          <>
            <Dot tone="ember" pulse />
            <span className="font-semibold text-base-100">
              {STAGE_META[state.currentStage].label}
            </span>
            <span className="truncate">{STAGE_META[state.currentStage].blurb}</span>
          </>
        ) : state.report ? (
          <>
            <Dot tone="ok" />
            <span className="font-semibold text-base-100">Run complete</span>
            <span>
              {state.report.passed} passed · {state.report.healed} healed ·{" "}
              {state.report.failed} failed · {state.report.bugs.length} bugs filed ·
              coverage {state.report.coverageScore}/100
            </span>
          </>
        ) : state.errors.length ? (
          (() => {
            const label = state.status === "cancelled" ? "Run cancelled" : "Run failed";
            const detail = state.errors.at(-1)?.message;
            return (
              <>
                <Dot tone="danger" />
                <span className="font-semibold text-base-100">{label}</span>
                {/* A cancelled run's last error *is* "Run cancelled", so the strip read
                    "Run cancelled  Run cancelled". The detail is printed only when it
                    says something the label did not. */}
                {detail && detail !== label ? (
                  <span className="truncate">{detail}</span>
                ) : null}
              </>
            );
          })()
        ) : (
          <>
            <Dot />
            <span>Initialising…</span>
          </>
        )}
        <span className="ml-auto shrink-0 font-mono text-meta text-base-500">
          {state.routes.length ? `${state.routes.length} routes mapped` : ""}
        </span>
      </footer>
    </main>
  );
}

/* -------------------------------------------------------------------------------------
   Tabs. Both columns are paged the same way, so they are paged by the same control.
   ----------------------------------------------------------------------------------- */

type LeftTab = "decisions" | "critic";
type Tab = "activity" | "suite" | "artifacts";

/** Ordered by when each one starts having something to say during a run. */
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "activity", label: "Activity" },
  { key: "suite", label: "Suite" },
  { key: "artifacts", label: "Artifacts" },
];

/** How many rows are behind each tab on the right. */
function tabCount(tab: Tab, state: RunState): number {
  return tab === "activity"
    ? state.activity.length
    : tab === "suite"
      ? state.tests.length
      : state.artifacts.length;
}

/** The critic's tab reports its grade rather than a row count — there is only ever one. */
function criticReadout(state: RunState): { readout: string; tone?: string } {
  const latest = state.critiques.at(-1);
  if (!latest) return { readout: "—" };
  return {
    readout: String(latest.score),
    tone: {
      neutral: "text-base-400",
      ember: "text-ember-400",
      ok: "text-ok-400",
      warn: "text-warn-500",
      danger: "text-danger-400",
      info: "text-info-500",
      violet: "text-violet-500",
    }[scoreTone(latest.score)],
  };
}

function TabStrip<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: K; label: string; readout: ReactNode; tone?: string }>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-base-800 bg-base-900 px-4 py-2">
      {tabs.map(({ key, label, readout, tone }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-detail font-medium transition",
            // A fill one step off the band was not a selection anyone could see. The
            // selected tab gets a border and a real lift.
            value === key
              ? "border-base-700 bg-base-800 text-base-100"
              : "border-transparent text-base-500 hover:bg-base-850 hover:text-base-200",
          )}
        >
          {label}
          {/* The count used to live inside the label string as "Suite (5)", which set a
              number at the same weight as the word beside it. It is a readout, so it is
              set as one — and it is present at zero rather than appearing mid-run and
              shifting the tab under the cursor. */}
          <span
            className={cn(
              "font-mono text-meta tabular-nums",
              tone ?? (value === key ? "text-base-400" : "text-base-500"),
            )}
          >
            {readout}
          </span>
        </button>
      ))}
    </div>
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
    // 9px uppercase on the dimmest ink in the ramp is a label you cannot read at arm's
    // length, on the three numbers a watcher checks most. Both go up a step.
    <div className="px-3 py-1.5">
      <div className="text-meta font-medium uppercase tracking-[0.08em] text-base-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-body font-medium tabular-nums",
          warn ? "text-warn-500" : "text-base-100",
        )}
      >
        {value}
        {hint ? <span className="ml-1 font-normal text-base-500">{hint}</span> : null}
      </div>
    </div>
  );
}

const ARTIFACT_ICON: Record<string, string> = {
  plan: "§",
  test: "⌗",
  trace: "≡",
  screenshot: "▢",
  video: "▷",
  patch: "±",
};

type ArtifactRow = { seq: number; kind: string; path: string; title: string };

const artifactHref = (runId: string, filePath: string) =>
  `/api/runs/${runId}/artifacts/${filePath.split("/").map(encodeURIComponent).join("/")}`;

function ArtifactRail({
  runId,
  artifacts,
}: {
  runId: string;
  artifacts: ArtifactRow[];
}) {
  // The suite records a screenshot and a video for every test, passing or failing, so a
  // suite of any size buries the plan and the specs under a wall of captures. The filter
  // is what keeps both reachable; it is not a view mode, so the tiles and the file rows
  // below render exactly as they do unfiltered.
  const [filter, setFilter] = useState<"all" | "screenshot" | "video" | "file">("all");
  /** The markdown artifact being read in the overlay, if any. */
  const [doc, setDoc] = useState<ArtifactRow | null>(null);

  const shown = artifacts.filter((a) =>
    filter === "all"
      ? true
      : filter === "file"
        ? a.kind !== "screenshot" && a.kind !== "video"
        : a.kind === filter,
  );

  // They are shown rather than listed: a filename is a claim that evidence exists, the
  // frame itself is the evidence.
  const media = shown.filter((a) => a.kind === "screenshot" || a.kind === "video");
  const files = shown.filter((a) => a.kind !== "screenshot" && a.kind !== "video");

  const count = (key: "all" | "screenshot" | "video" | "file") =>
    key === "all"
      ? artifacts.length
      : key === "file"
        ? artifacts.filter((a) => a.kind !== "screenshot" && a.kind !== "video").length
        : artifacts.filter((a) => a.kind === key).length;

  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title="Artifacts"
        subtitle="Real files on disk — captures of every test, plus the suite itself"
        right={
          <div className="flex shrink-0 flex-wrap gap-1">
            {(
              [
                ["all", "All"],
                ["screenshot", "Photos"],
                ["video", "Videos"],
                ["file", "Files"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                // A pill for a kind the run has not produced is disabled rather than
                // hidden: a row of buttons that reshuffles itself as artifacts stream in
                // moves the one being aimed at.
                disabled={count(key) === 0}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-meta font-medium transition",
                  filter === key
                    ? "border-base-700 bg-base-850 text-base-100"
                    : "border-base-800 text-base-500 hover:border-base-700 hover:text-base-200",
                  count(key) === 0 && "opacity-45 hover:border-base-800 hover:text-base-500",
                )}
              >
                {label}
                <span className="ml-1 font-mono tabular-nums text-base-500">{count(key)}</span>
              </button>
            ))}
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {artifacts.length === 0 ? (
          <Empty>Nothing written yet</Empty>
        ) : (
          <>
            {media.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 px-6 py-4 xl:grid-cols-3">
                {media.map((a) => (
                  <li key={a.seq} className="animate-stream-in">
                    <a
                      href={artifactHref(runId, a.path)}
                      target="_blank"
                      rel="noreferrer"
                      className="group block overflow-hidden rounded-md border border-base-850 bg-base-900 transition hover:border-base-700"
                    >
                      <div className="aspect-video bg-base-950">
                        {a.kind === "video" ? (
                          // Muted and preloaded to metadata: a dozen of these autoplaying
                          // at once would be a wall of noise and a wall of bytes. The
                          // controls are here so a capture can be watched in place.
                          <video
                            src={artifactHref(runId, a.path)}
                            controls
                            muted
                            preload="metadata"
                            className="size-full object-contain"
                          />
                        ) : (
                          // Served by the run's own artifact route from a workspace on
                          // disk, so there is nothing for next/image to optimise.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={artifactHref(runId, a.path)}
                            alt={a.title}
                            loading="lazy"
                            className="size-full object-contain"
                          />
                        )}
                      </div>
                      <div className="border-t border-base-850 px-2.5 py-1.5">
                        <p className="truncate text-detail text-base-200">{a.title}</p>
                        <p className="truncate font-mono text-meta text-base-500">
                          {a.kind}
                        </p>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <ul
              className={cn(
                "divide-y divide-base-850",
                media.length > 0 && "border-t border-base-850",
              )}
            >
              {files.map((a) => {
                const href = artifactHref(runId, a.path);
                const row = (
                  <>
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded border border-base-800 bg-base-850 font-mono text-meta text-base-400"
                    >
                      {ARTIFACT_ICON[a.kind] ?? "·"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-base-200">{a.title}</p>
                      <p className="truncate font-mono text-meta text-base-500">{a.path}</p>
                    </div>
                  </>
                );
                const rowClass =
                  "flex w-full items-center gap-3 px-6 py-2.5 text-left transition hover:bg-base-900";
                return (
                  <li key={a.seq} className="animate-stream-in">
                    {/* Openable, not merely named. A run writes real files and a rail that
                        only lists their paths is describing evidence rather than showing
                        it. A markdown file opens rendered, in place: served as
                        `text/markdown` under a `default-src 'none'` sandbox, a new tab
                        shows the plan as raw asterisks and pipes. */}
                    {a.path.toLowerCase().endsWith(".md") ? (
                      <button onClick={() => setDoc(a)} className={rowClass}>
                        {row}
                      </button>
                    ) : (
                      <a href={href} target="_blank" rel="noreferrer" className={rowClass}>
                        {row}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {doc ? (
        <MarkdownSheet
          key={doc.seq}
          href={artifactHref(runId, doc.path)}
          title={doc.title}
          subtitle={doc.path}
          onClose={() => setDoc(null)}
        />
      ) : null}
    </Section>
  );
}
