import { cn, formatDuration } from "@/lib/format";
import { STAGES, STAGE_META, type RunState } from "@/lib/types";

/**
 * The eight stages as one rail, not eight cards.
 *
 * Each stage used to carry its own two-line blurb, which made the strip 8 × 10rem wide —
 * wider than the console at any normal window size, so the run ended off the right edge
 * with nothing to say it was there. The blurb is already printed, for the stage that is
 * actually running, in the status strip at the foot of the console; here the rail only
 * has to answer "where is it, and how long did each part take", and that fits.
 */
export function StagePipeline({ state }: { state: RunState }) {
  const doneCount = STAGES.filter((s) => state.stages[s].status === "done").length;

  return (
    <div className="relative">
      <ol className="flex items-stretch overflow-x-auto">
        {STAGES.map((stage, i) => {
          const s = state.stages[stage];
          const meta = STAGE_META[stage];
          const active = s.status === "active";
          const done = s.status === "done";
          const failed = s.status === "failed";
          const reached = done || active || failed;

          return (
            <li
              key={stage}
              // The blurb the card used to print in full. It is one hover away here,
              // and one glance away in the status strip while the stage is running.
              title={`${meta.label} — ${meta.blurb}`}
              aria-current={active ? "step" : undefined}
              className={cn(
                "group relative min-w-[6.5rem] flex-1 px-3 py-2.5 transition-colors duration-300",
                i > 0 && "border-l border-base-850",
                active && "bg-ember-600/10",
                failed && "bg-danger-500/8",
              )}
            >
              <div className="flex items-center gap-2">
                <StageGlyph status={s.status} attempt={s.attempt} />
                <span
                  className={cn(
                    "truncate text-xs font-medium tracking-tight transition-colors",
                    active && "text-ember-300",
                    done && "text-base-200",
                    failed && "text-danger-400",
                    !reached && "text-base-600",
                  )}
                >
                  {meta.label}
                </span>
              </div>
              <span
                className={cn(
                  "mt-1.5 block font-mono text-[10px] tabular-nums",
                  active ? "text-ember-400/80" : "text-base-600",
                )}
              >
                {s.durationMs
                  ? formatDuration(s.durationMs)
                  : active
                    ? "running"
                    : failed
                      ? "failed"
                      : "—"}
              </span>
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
                  <span className="block h-full w-1/3 animate-scan bg-ember-400" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* One hairline across the whole rail, filled to the last finished stage: the
          shape of the run at a glance, without reading eight labels. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-base-850">
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
    "flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none";
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
          "animate-pulse-ring border-ember-500/50 bg-ember-500/15 font-mono text-ember-300",
        )}
      >
        {attempt > 1 ? attempt : "▸"}
      </span>
    );
  return <span className={cn(base, "border-base-800 text-base-700")}>·</span>;
}
