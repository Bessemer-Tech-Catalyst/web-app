import { cn, formatDuration } from "@/lib/format";
import { STAGES, STAGE_META, type RunState } from "@/lib/types";

/**
 * The run's spine: eight stages, their state, and what each one cost in time.
 *
 * The blurb that used to sit under each stage ("Crawl the app, authenticate, map every
 * interactive surface") is static copy that never varies between runs, and it was printed
 * eight times across the widest band on the page — which pushed the eight stages past the
 * viewport so the last two scrolled out of sight. It is shown for the *current* stage
 * only, in the footer, where it is help for the thing happening now rather than eight
 * paragraphs of chrome, and it stays one hover away here. The strip is one row again, and
 * the durations it has room for now say where the run's time went.
 */
export function StagePipeline({ state }: { state: RunState }) {
  const doneCount = STAGES.filter((s) => state.stages[s].status === "done").length;

  return (
    <div>
      {/* gap-px over a hairline ground, rather than a border on every cell keyed to its
          index: the eight stages wrap to four columns and then two as the console
          narrows, and index arithmetic cannot know which cell starts a row once the
          count changes. The gaps draw themselves correctly at every width. */}
      <ol className="grid grid-cols-2 gap-px bg-base-850 sm:grid-cols-4 xl:grid-cols-8">
        {STAGES.map((stage) => {
          const s = state.stages[stage];
          const meta = STAGE_META[stage];
          const active = s.status === "active";
          const done = s.status === "done";
          const failed = s.status === "failed";

          return (
            <li
              key={stage}
              title={`${meta.label} — ${meta.blurb}`}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 px-4 py-3",
                active
                  ? "bg-ember-600/[0.09]"
                  : failed
                    ? "bg-danger-500/[0.09]"
                    : "bg-base-950",
              )}
            >
              <StageGlyph status={s.status} attempt={s.attempt} />
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate text-body font-semibold tracking-tight",
                    active && "text-ember-300",
                    failed && "text-danger-400",
                    done && "text-base-200",
                    !active && !done && !failed && "text-base-600",
                  )}
                >
                  {meta.label}
                </div>
                <div
                  className={cn(
                    "font-mono text-meta tabular-nums",
                    active ? "text-ember-400" : "text-base-600",
                  )}
                >
                  {s.durationMs
                    ? formatDuration(s.durationMs)
                    : active
                      ? "running"
                      : failed
                        ? "failed"
                        : "—"}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* One hairline under the whole strip, filled to the last finished stage: the shape
          of the run at a glance, without reading eight labels. Drawn as its own row rather
          than pinned to the bottom of the grid, so it stays one bar when the strip wraps. */}
      <div aria-hidden className="h-px bg-base-850">
        <div
          className="h-full bg-ember-600/60 transition-[width] duration-700 ease-out"
          style={{ width: `${(doneCount / STAGES.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StageGlyph({ status, attempt }: { status: string; attempt: number }) {
  const base =
    "flex size-5 shrink-0 items-center justify-center rounded-full border text-meta leading-none";
  if (status === "done")
    return (
      <span className={cn(base, "border-ok-500/40 bg-ok-500/12 text-ok-400")}>✓</span>
    );
  if (status === "failed")
    return (
      <span className={cn(base, "border-danger-500/45 bg-danger-500/12 text-danger-400")}>
        ✕
      </span>
    );
  if (status === "active")
    return (
      <span
        className={cn(
          base,
          "animate-pulse-ring border-ember-500/50 bg-ember-500/15 font-mono text-ember-400",
        )}
      >
        {attempt > 1 ? attempt : "▸"}
      </span>
    );
  return <span className={cn(base, "border-base-800 text-base-700")}>·</span>;
}
