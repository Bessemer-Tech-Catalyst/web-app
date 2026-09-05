"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Section, SectionHeader, Empty, type Tone } from "@/components/ui/primitives";
import { cn, formatDuration } from "@/lib/format";
import {
  TRIAGE_META,
  type GeneratedTest,
  type HealAttempt,
  type OrchestratorEvent,
  type TestResult,
  type TestStatus,
  type TriageOutcome,
} from "@/lib/types";

type ArtifactEvent = Extract<OrchestratorEvent, { type: "artifact" }>;

/** What a run's artifact endpoint expects: every segment encoded, slashes kept. */
const artifactHref = (runId: string, path: string) =>
  `/api/runs/${runId}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

const EVIDENCE_LABEL: Partial<Record<ArtifactEvent["kind"], string>> = {
  trace: "trace",
  video: "video",
  screenshot: "screenshot",
  patch: "heal diff",
};

const STATUS_TONE: Record<TestStatus, Tone> = {
  passed: "ok",
  healed: "ember",
  failed: "danger",
  quarantined: "violet",
  running: "info",
  pending: "neutral",
};

export function TestBoard({
  runId,
  tests,
  results,
  triage,
  heals,
  artifacts,
}: {
  runId: string;
  tests: GeneratedTest[];
  results: Record<string, TestResult>;
  triage: TriageOutcome[];
  heals: HealAttempt[];
  artifacts: ArtifactEvent[];
}) {
  const counts = tests.reduce<Record<string, number>>((acc, t) => {
    const st = results[t.id]?.status ?? "pending";
    acc[st] = (acc[st] ?? 0) + 1;
    return acc;
  }, {});

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = useCallback(
    (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] })),
    [],
  );

  // The evidence a run produced for one test, indexed once rather than filtered per row.
  // The spec file itself is left out: it is rendered inline below, not linked away to.
  const evidence = useMemo(() => {
    const byTest = new Map<string, ArtifactEvent[]>();
    for (const a of artifacts) {
      if (!a.testId || a.kind === "test") continue;
      const list = byTest.get(a.testId);
      if (list) list.push(a);
      else byTest.set(a.testId, [a]);
    }
    return byTest;
  }, [artifacts]);

  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title="Generated suite"
        subtitle="Locators proven live before the file was written"
        right={
          tests.length > 0 ? (
            <div className="flex gap-1">
              {(["passed", "healed", "failed"] as const).map((s) =>
                counts[s] ? (
                  <Badge key={s} tone={STATUS_TONE[s]} mono>
                    {counts[s]} {s}
                  </Badge>
                ) : null,
              )}
            </div>
          ) : null
        }
      />
      <div className="max-h-[55vh] min-h-0 flex-1 overflow-y-auto">
        {tests.length === 0 ? (
          <Empty>No tests generated yet</Empty>
        ) : (
          <ul className="divide-y divide-base-850">
            {tests.map((t) => {
              const result = results[t.id];
              const status = result?.status ?? "pending";
              const verdict = triage.find((v) => v.testId === t.id);
              const testHeals = heals.filter((h) => h.testId === t.id);
              const expanded = open[t.id] ?? false;

              return (
                <li
                  key={t.id}
                  className="animate-stream-in px-6 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <StatusGlyph status={status} />
                    <div className="min-w-0 flex-1">
                      {/* The row is the disclosure. A file path printed as dead text says
                          a test was written; the source says what it actually asserts,
                          and that is the thing worth checking. */}
                      <button
                        type="button"
                        onClick={() => toggle(t.id)}
                        aria-expanded={expanded}
                        className="group flex w-full items-start gap-1.5 text-left"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.75 shrink-0 font-mono text-meta text-base-500 transition-transform group-hover:text-base-400",
                            expanded && "rotate-90",
                          )}
                        >
                          ▶
                        </span>
                        <span
                          className={cn(
                            "text-body leading-snug transition group-hover:text-base-100",
                            status === "pending" ? "text-base-500" : "text-base-200",
                          )}
                        >
                          {t.title}
                        </span>
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-3.75">
                        <span className="font-mono text-meta text-base-500">
                          {t.file}
                        </span>
                        <span
                          className="font-mono text-meta text-ok-400"
                          title="Locators verified against the live page"
                        >
                          ⌖ {t.selectorsVerified}/{t.selectorsTotal}
                        </span>
                        {result?.durationMs ? (
                          <span className="font-mono text-meta text-base-500">
                            {formatDuration(result.durationMs)}
                          </span>
                        ) : null}
                        {result && result.attempt > 1 ? (
                          <span className="font-mono text-meta text-ember-400">
                            attempt {result.attempt}
                          </span>
                        ) : null}
                      </div>

                      {result?.error ? (
                        // The block being red is what says the test failed. Setting the
                        // eight lines of trace inside it in red as well makes the one
                        // thing you have to actually read the hardest thing to read, so
                        // the frame carries the verdict and the text stays plain ink.
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded border border-danger-500/30 bg-danger-500/8 px-2.5 py-2 font-mono text-meta leading-4 text-base-300">
                          {result.error}
                        </pre>
                      ) : null}

                      {verdict ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge tone={TRIAGE_META[verdict.verdict].tone}>
                            {TRIAGE_META[verdict.verdict].label}
                          </Badge>
                          <span className="text-meta text-base-500">
                            {TRIAGE_META[verdict.verdict].action} ·{" "}
                            {Math.round(verdict.confidence * 100)}% confident
                          </span>
                        </div>
                      ) : null}

                      {testHeals.map((h) => (
                        <div
                          key={`${h.testId}-${h.attempt}`}
                          className={cn(
                            "mt-1.5 rounded border px-2 py-1.5",
                            h.outcome === "rejected"
                              ? "border-danger-500/25 bg-danger-500/6"
                              : "border-ember-600/25 bg-ember-600/6",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              tone={h.outcome === "rejected" ? "danger" : "ember"}
                            >
                              heal #{h.attempt} · {h.outcome}
                            </Badge>
                            {!h.assertionsIntact && (
                              <span className="text-meta font-medium text-danger-400">
                                assertion guard tripped
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-meta leading-relaxed text-base-500">
                            {h.summary}
                          </p>
                        </div>
                      ))}

                      {expanded ? (
                        <div className="mt-2 pl-3.75">
                          <SpecSource key={t.file} runId={runId} file={t.file} />
                          <Evidence runId={runId} artifacts={evidence.get(t.id) ?? []} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

/**
 * The emitted spec, read back off disk.
 *
 * Fetched rather than streamed through the event log: the file is already served by the
 * run's artifact endpoint, and putting a few kilobytes of source into every
 * `test.generated` event would bloat the log that the whole console replays on reload.
 * This component only mounts when a row is open, so nothing is fetched until it is asked
 * for, and a run of twenty tests still costs one request.
 */
function SpecSource({ runId, file }: { runId: string; file: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ok"; code: string } | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    // No reset to "loading" here: the effect's inputs are fixed for the life of this
    // component — a row's file never changes under it, and the call site keys on it —
    // so the initial state is already the right one and re-setting it only costs a
    // render.
    fetch(artifactHref(runId, file), { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} — the file is not on disk`);
        return res.text();
      })
      .then((code) => setState({ status: "ok", code }))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not read the file",
        });
      });
    return () => abort.abort();
  }, [runId, file]);

  return (
    <div className="overflow-hidden rounded border border-base-800 bg-base-950">
      <div className="flex items-center gap-2 border-b border-base-850 px-2.5 py-1.5">
        <span className="truncate font-mono text-meta text-base-500">{file}</span>
        <a
          href={artifactHref(runId, file)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 font-mono text-meta text-base-500 transition hover:text-base-200"
        >
          open raw ↗
        </a>
      </div>
      {state.status === "loading" ? (
        <p className="px-2.5 py-2 font-mono text-meta text-base-500">Reading the file…</p>
      ) : state.status === "error" ? (
        <p className="px-2.5 py-2 font-mono text-meta text-danger-400">{state.message}</p>
      ) : (
        // Capped and scrollable: a spec is routinely longer than the panel it sits in,
        // and a row that grows to 200 lines pushes every other test off the screen.
        <pre className="max-h-72 overflow-auto px-2.5 py-2 font-mono text-meta leading-[1.55] text-base-300">
          <code>{state.code}</code>
        </pre>
      )}
    </div>
  );
}

/** Trace, video, screenshots, heal diffs — what the run recorded while this test ran. */
function Evidence({ runId, artifacts }: { runId: string; artifacts: ArtifactEvent[] }) {
  if (artifacts.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {artifacts.map((a) => (
        <a
          key={`${a.seq}`}
          href={artifactHref(runId, a.path)}
          target="_blank"
          rel="noreferrer"
          title={a.path}
          className="rounded border border-base-800 bg-base-900 px-1.5 py-0.5 font-mono text-meta text-base-400 transition hover:border-base-700 hover:text-base-100"
        >
          {EVIDENCE_LABEL[a.kind] ?? a.kind} ↗
        </a>
      ))}
    </div>
  );
}

function StatusGlyph({ status }: { status: TestStatus }) {
  const map: Record<TestStatus, { char: string; cls: string }> = {
    passed: { char: "✓", cls: "border-ok-500/40 bg-ok-500/12 text-ok-400" },
    healed: { char: "⟲", cls: "border-ember-500/40 bg-ember-600/12 text-ember-400" },
    failed: { char: "✕", cls: "border-danger-500/40 bg-danger-500/12 text-danger-400" },
    quarantined: {
      char: "◧",
      cls: "border-violet-500/40 bg-violet-500/12 text-violet-500",
    },
    running: { char: "▸", cls: "border-info-500/40 bg-info-500/12 text-info-500" },
    pending: { char: "·", cls: "border-base-800 bg-base-850 text-base-500" },
  };
  const { char, cls } = map[status];
  return (
    <span
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-meta leading-none",
        cls,
      )}
      title={status}
    >
      {char}
    </span>
  );
}
