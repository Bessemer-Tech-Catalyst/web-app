import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardHeader, Dot, Stat } from "@/components/ui/primitives";
import { SCHEDULES, formatCountdown, targetName } from "@/lib/mock-fleet";
import { formatDuration } from "@/lib/format";

export const metadata = { title: "Schedule — The Odyssey" };

export default function SchedulePage() {
  const enabled = SCHEDULES.filter((s) => s.enabled);
  const nextUp = [...enabled].sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))[0];
  const weeklyScenarios = enabled.reduce((n, s) => n + s.scenarios, 0);

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Standing orders. Each one launches the same autonomous pipeline — no human between the stages."
        actions={
          <button className="rounded-lg border border-base-800 px-3.5 py-2 text-[13px] text-base-300 transition hover:border-base-700 hover:text-base-100">
            New schedule
          </button>
        }
      />

      <PageBody className="space-y-5">
        <Card className="grid divide-y divide-base-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat label="Active schedules" value={enabled.length} hint={`${SCHEDULES.length} configured`} />
          <Stat
            label="Next launch"
            value={nextUp ? formatCountdown(nextUp.nextRunAt) : "—"}
            tone="ember"
            hint={nextUp?.name}
          />
          <Stat
            label="Scenarios per cycle"
            value={weeklyScenarios}
            hint="Across all enabled schedules"
          />
        </Card>

        <Card>
          <CardHeader
            title="Standing schedules"
            subtitle="Cron cadence, target, and the intent handed to the planner"
          />
          <div className="divide-y divide-base-800">
            {SCHEDULES.map((s) => (
              <div key={s.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Dot tone={s.enabled ? "ok" : "neutral"} />
                      <span className="text-[13px] font-medium text-base-100">
                        {s.name}
                      </span>
                      <Badge tone={s.enabled ? "ok" : "neutral"}>
                        {s.enabled ? "enabled" : "paused"}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-500">
                      <span>{targetName(s.targetId)}</span>
                      <span className="text-base-700">·</span>
                      <span>{s.cadence}</span>
                      <span className="text-base-700">·</span>
                      <code className="rounded border border-base-800 bg-base-950/70 px-1.5 py-0.5 font-mono text-[11px] text-base-400">
                        {s.cron}
                      </code>
                    </div>
                    {s.intent ? (
                      <p className="mt-2 text-xs italic text-base-500">“{s.intent}”</p>
                    ) : (
                      <p className="mt-2 text-xs text-base-600">
                        No intent — the planner scopes it from recon alone.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-base-600">
                        Next run
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-ember-400">
                        {s.enabled ? formatCountdown(s.nextRunAt) : "paused"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-base-600">
                        Typical
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-base-400">
                        {s.scenarios} · {formatDuration(s.avgDurationMs)}
                      </div>
                    </div>
                    {s.lastRunId ? (
                      <Link
                        href={`/runs/${s.lastRunId}`}
                        className="rounded-lg border border-base-800 px-3 py-1.5 text-xs text-base-300 transition hover:border-base-700 hover:text-base-100"
                      >
                        Last run
                      </Link>
                    ) : null}
                  </div>
                </div>

                {s.lastStatus === "failed" ? (
                  <p className="mt-3 rounded-lg border border-danger-500/25 bg-danger-500/8 px-3 py-2 text-xs text-danger-400">
                    Last cycle finished with failures the classifier attributed to the
                    application — the schedule kept running rather than healing them away.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
