import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Dot, Row, Section, SectionHeader, SplitGrid, Stat } from "@/components/ui/primitives";
import { formatDuration, formatRelative, hostOf } from "@/lib/format";
import type { RunStatus } from "@/lib/types";
import type { Tone } from "@/components/ui/primitives";
import { listRuns, getRunState } from "@/server/run-store";

const STATUS_TONE: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "ember",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export default async function OverviewPage() {
  const runs = await listRuns();
  const runStates = await Promise.all(
    runs.map(async (r) => ({ ...r, state: await getRunState(r.id) })),
  );

  const avgCoverage =
    runs.length > 0
      ? Math.round(
          runs.reduce((n, r) => n + r.coverageScore, 0) / runs.length,
        )
      : 0;
  const healed = runs.reduce((n, r) => n + r.healed, 0);
  const allBugs = runStates.flatMap((r) =>
    (r.state?.report?.bugs ?? []).map((b) => ({ ...b, runId: r.id }))
  );
  const allRisks = runStates.flatMap((r) =>
    (r.state?.report?.risks ?? []).map((ri) => ({ ...ri, runId: r.id }))
  );
  const riskiest = allRisks
    .filter((c) => c.risk === "critical" || c.risk === "high")
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live test orchestration dashbaord"
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
        {/* ---- headline numbers ---- */}
        <Section>
          <SplitGrid cols={4}>
            <Stat label="Completed runs" value={runs.length} hint="Test suites finished" />
            <Stat
              label="Avg coverage"
              value={avgCoverage}
              tone={avgCoverage >= 85 ? "ok" : "warn"}
              hint="Critic score across runs"
            />
            <Stat
              label="Tests healed"
              value={healed}
              tone="ember"
              hint="Locators repaired without weakening assertions"
            />
            <Stat
              label="Open defects"
              value={allBugs.length}
              tone={allBugs.length ? "danger" : "ok"}
              hint="Genuine app bugs filed"
            />
          </SplitGrid>
        </Section>

        <Section className="grid lg:grid-cols-3 lg:divide-x lg:divide-base-850">
          {/* ---- recent runs ---- */}
          <div className="lg:col-span-2">
            <SectionHeader
              title="Recent runs"
              subtitle="Newest first"
              right={
                <Link href="/runs" className="text-xs text-ember-400 hover:text-ember-300">
                  All runs →
                </Link>
              }
            />
            <div className="divide-y divide-base-850">
              {runs.slice(0, 5).map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-base-900/60"
                >
                  <Dot tone={STATUS_TONE[r.status]} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-base-200">
                      {hostOf(r.url)}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-base-600">
                      {formatRelative(r.startedAt)} · {formatDuration(r.durationMs)}
                    </div>
                  </div>
                  <span className="hidden w-24 text-right font-mono text-xs text-base-500 sm:block">
                    <span className="text-ok-400">{r.passed}</span>
                    {" / "}
                    <span className={r.failed ? "text-danger-400" : "text-base-600"}>
                      {r.failed}
                    </span>
                    <span className="text-base-700"> of {r.scenarios}</span>
                  </span>
                  <Badge tone={r.coverageScore >= 85 ? "ok" : "warn"} mono>
                    {r.coverageScore}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>

          {/* ---- stats ---- */}
          <div className="border-t border-base-850 lg:border-t-0">
            <SectionHeader
              title="Fleet stats"
              subtitle="Aggregated"
            />
            <div className="space-y-4 px-6 py-4">
              <div>
                <div className="text-xs text-base-600">Total cost</div>
                <div className="text-lg font-semibold text-base-100">
                  ${runs.reduce((n, r) => n + r.costUsd, 0).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Avg duration</div>
                <div className="text-lg font-semibold text-base-100">
                  {runs.length > 0
                    ? formatDuration(Math.round(runs.reduce((n, r) => n + r.durationMs, 0) / runs.length))
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Total replans</div>
                <div className="text-lg font-semibold text-base-100">
                  {runs.reduce((n, r) => n + r.replans, 0)}
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section flush className="grid lg:grid-cols-2 lg:divide-x lg:divide-base-850">
          {/* ---- defects ---- */}
          <div>
            <SectionHeader
              title="Open defects"
              subtitle="Genuine app bugs"
              right={
                <Link
                  href="/defects"
                  className="text-xs text-ember-400 hover:text-ember-300"
                >
                  All →
                </Link>
              }
            />
            <div className="divide-y divide-base-850">
              {allBugs.slice(0, 4).map((d) => (
                <Row key={`${d.runId}-${d.id}`}>
                  <div className="flex items-start gap-2">
                    <Badge tone={d.severity === "critical" ? "danger" : "warn"}>
                      {d.severity}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-base-200">
                      {d.title}
                    </span>
                  </div>
                </Row>
              ))}
            </div>
          </div>

          {/* ---- riskiest untested ---- */}
          <div className="border-t border-base-850 lg:border-t-0">
            <SectionHeader
              title="High-risk surfaces"
              subtitle="Barely tested areas"
              right={
                <Link
                  href="/coverage"
                  className="text-xs text-ember-400 hover:text-ember-300"
                >
                  Coverage →
                </Link>
              }
            />
            <div className="divide-y divide-base-850">
              {riskiest.slice(0, 4).map((c) => (
                <Row key={`${c.runId}-${c.id}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-base-200">{c.surface}</span>
                    <Badge tone={c.risk === "critical" ? "danger" : "warn"}>
                      {c.risk}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-base-600">
                    {c.reasons.join(" · ")}
                  </p>
                </Row>
              ))}
            </div>
          </div>
        </Section>
      </PageBody>
    </>
  );
}
