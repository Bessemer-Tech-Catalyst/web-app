import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Dot, SampleNotice, Section, type Tone } from "@/components/ui/primitives";
import { RUN_HISTORY, targetName, type RunHistoryEntry } from "@/lib/mock-fleet";
import { listRuns } from "@/server/run-store";
import { formatDuration, formatRelative, formatUsd, hostOf } from "@/lib/format";
import type { RunStatus } from "@/lib/types";

export const metadata = { title: "Past runs — The Odyssey" };

// Real runs are read from the run index on every request; nothing here is cached.
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "ember",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export default async function RunsPage() {
  // Runs this instance has actually driven, ahead of the seeded fleet history the
  // other pages still read from.
  const real: RunHistoryEntry[] = (await listRuns()).map((r) => ({
    ...r,
    targetId: "",
    trigger: "manual" as const,
  }));

  // Seeded history is kept — an empty table teaches a first-time reader nothing about
  // what the console is for — but every seeded row says so on its own line. A real run
  // and a fixture must never be indistinguishable on the page that lists both.
  const runs = [
    ...real.map((r) => ({ ...r, sample: false })),
    ...RUN_HISTORY.map((r) => ({ ...r, sample: true })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <>
      <PageHeader
        title="Past runs"
        subtitle="Every pipeline the orchestrator has driven, with what it decided along the way."
        actions={
          <Link
            href="/new"
            className="rounded-md bg-ember-500 px-3.5 py-2 text-[13px] font-semibold text-base-950 transition hover:bg-ember-400"
          >
            New run
          </Link>
        }
      />
      <PageBody>
        {real.length === 0 ? (
          <SampleNotice>
            This instance has not driven a run yet, so every row below is seeded. Start one
            from <span className="text-base-200">New run</span> and it appears here, above
            these, without a sample badge.
          </SampleNotice>
        ) : null}
        <Section>
          {/* Column heads — mirrored by the row grid below. */}
          <div className="hidden grid-cols-[1.6fr_repeat(5,minmax(0,0.62fr))_auto] gap-3 border-b border-base-850 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.12em] text-base-600 lg:grid">
            <span>Target</span>
            <span className="text-right">Pass / fail</span>
            <span className="text-right">Healed</span>
            <span className="text-right">Bugs</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Cost</span>
            <span className="w-12 text-right">Score</span>
          </div>

          <div className="divide-y divide-base-850">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={`/runs/${r.id}`}
                className="grid grid-cols-1 gap-3 px-6 py-3.5 transition hover:bg-base-900/60 lg:grid-cols-[1.6fr_repeat(5,minmax(0,0.62fr))_auto] lg:items-center"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-1.5">
                    <Dot tone={STATUS_TONE[r.status]} pulse={r.status === "running"} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-base-200">
                        {r.targetId ? targetName(r.targetId) : hostOf(r.url)}
                      </span>
                      <Badge tone={r.trigger === "schedule" ? "info" : "neutral"}>
                        {r.trigger}
                      </Badge>
                      {r.replans ? (
                        <Badge tone="violet">{r.replans}× re-plan</Badge>
                      ) : null}
                      {r.sample ? <Badge tone="violet">sample</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-base-600">
                      {hostOf(r.url)} · {r.id} · {formatRelative(r.startedAt)}
                    </div>
                    {r.intent ? (
                      <div className="mt-1 truncate text-xs italic text-base-600">
                        “{r.intent}”
                      </div>
                    ) : null}
                  </div>
                </div>

                <Cell label="Pass / fail">
                  <span className="text-ok-400">{r.passed}</span>
                  <span className="text-base-700"> / </span>
                  <span className={r.failed ? "text-danger-400" : "text-base-600"}>
                    {r.failed}
                  </span>
                </Cell>
                <Cell label="Healed">
                  <span className={r.healed ? "text-ember-400" : "text-base-600"}>
                    {r.healed}
                  </span>
                </Cell>
                <Cell label="Bugs">
                  <span className={r.bugs ? "text-danger-400" : "text-base-600"}>
                    {r.bugs}
                  </span>
                </Cell>
                <Cell label="Duration">{formatDuration(r.durationMs)}</Cell>
                <Cell label="Cost">{formatUsd(r.costUsd)}</Cell>

                <div className="flex justify-end">
                  <Badge tone={r.coverageScore >= 85 ? "ok" : "warn"} mono>
                    {r.coverageScore}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      </PageBody>
    </>
  );
}

/** Stacks label-over-value on narrow screens; collapses to a bare number on wide. */
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 lg:justify-end">
      <span className="text-[10px] uppercase tracking-wider text-base-600 lg:hidden">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums text-base-400">{children}</span>
    </div>
  );
}
