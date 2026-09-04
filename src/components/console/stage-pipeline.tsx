import { Fragment } from "react";
import { cn, formatDuration } from "@/lib/format";
import { STAGES, STAGE_META, type RunState } from "@/lib/types";

export function StagePipeline({ state }: { state: RunState }) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch">
        {STAGES.map((stage, i) => {
          const s = state.stages[stage];
          const meta = STAGE_META[stage];
          const active = s.status === "active";
          const done = s.status === "done";
          const failed = s.status === "failed";

          return (
            <Fragment key={stage}>
              {i > 0 && (
                <div
                  aria-hidden
                  className={cn(
                    "w-px shrink-0 transition-colors duration-500",
                    done || active ? "bg-ember-600/40" : "bg-base-850",
                  )}
                />
              )}
              <li
                className={cn(
                  "relative min-w-[10rem] max-w-[12rem] flex-1 px-4 py-3 transition-colors duration-300",
                  active && "bg-ember-600/10",
                  failed && "bg-danger-500/8",
                )}
                aria-current={active ? "step" : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-xs font-semibold tracking-tight",
                      active && "text-ember-300",
                      done && "text-base-200",
                      failed && "text-danger-400",
                      !active && !done && !failed && "text-base-600",
                    )}
                  >
                    {meta.label}
                  </span>
                  <StageGlyph status={s.status} attempt={s.attempt} />
                </div>
                <p
                  className={cn(
                    "mt-1.5 line-clamp-2 text-[11px] leading-snug",
                    active ? "text-base-400" : "text-base-600",
                  )}
                >
                  {meta.blurb}
                </p>
                {s.durationMs ? (
                  <span className="mt-2 block font-mono text-[10px] text-base-600">
                    {formatDuration(s.durationMs)}
                  </span>
                ) : null}
                {active ? (
                  <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
                    <span className="block h-full w-1/3 animate-scan bg-ember-400" />
                  </span>
                ) : null}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

function StageGlyph({ status, attempt }: { status: string; attempt: number }) {
  if (status === "done")
    return <span className="text-[11px] leading-none text-ok-500">✓</span>;
  if (status === "failed")
    return <span className="text-[11px] leading-none text-danger-400">✕</span>;
  if (status === "active")
    return (
      <span className="font-mono text-[10px] leading-none text-ember-400">
        {attempt > 1 ? `#${attempt}` : "▸"}
      </span>
    );
  return <span className="text-[11px] leading-none text-base-700">·</span>;
}
