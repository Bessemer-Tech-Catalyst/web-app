import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import {
  Badge,
  Dot,
  Meter,
  Row,
  Section,
  SectionHeader,
  SplitGrid,
  Stat,
} from "@/components/ui/primitives";
import {
  COVERAGE,
  DEFECTS,
  RUN_HISTORY,
  RUNS_LAST_24H,
  SCHEDULES,
  formatCountdown,
  targetName,
} from "@/lib/mock-fleet";
import { formatDuration, formatRelative, hostOf } from "@/lib/format";
import type { RunStatus } from "@/lib/types";
import type { Tone } from "@/components/ui/primitives";

const STATUS_TONE: Record<RunStatus, Tone> = {
  queued: "neutral",
  running: "ember",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export default function OverviewPage() {
  const avgCoverage = Math.round(
    RUN_HISTORY.reduce((n, r) => n + r.coverageScore, 0) / RUN_HISTORY.length,
  );
  const healed = RUN_HISTORY.reduce((n, r) => n + r.healed, 0);
  const openDefects = DEFECTS.filter((d) => d.status !== "fixed");
  const next = [...SCHEDULES]
    .filter((s) => s.enabled)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  const riskiest = [...COVERAGE]
    .filter((c) => c.risk === "critical" || c.risk === "high")
    .sort((a, b) => a.scenarios - b.scenarios);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What the orchestrator has been doing while you weren't watching."
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
          <Stat label="Runs · 24h" value={RUNS_LAST_24H.length} hint={`${RUN_HISTORY.length} total on record`} />
          <Stat
            label="Avg coverage"
            value={avgCoverage}
            tone={avgCoverage >= 85 ? "ok" : "warn"}
            hint="Critic score across all targets"
          />
          <Stat
            label="Tests healed"
            value={healed}
            tone="ember"
            hint="Locators repaired without weakening assertions"
          />
          <Stat
            label="Open defects"
            value={openDefects.length}
            tone={openDefects.length ? "danger" : "ok"}
            hint="Classified as app bugs, not script drift"
          />
          </SplitGrid>
        </Section>

        <Section className="grid lg:grid-cols-3 lg:divide-x lg:divide-base-850">
          {/* ---- recent runs ---- */}
          <div className="lg:col-span-2">
            <SectionHeader
              title="Recent runs"
              subtitle="Newest first, manual and scheduled together"
              right={
                <Link href="/runs" className="text-xs text-ember-400 hover:text-ember-300">
                  All runs →
                </Link>
              }
            />
            <div className="divide-y divide-base-850">
              {RUN_HISTORY.slice(0, 5).map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-base-900/60"
                >
                  <Dot tone={STATUS_TONE[r.status]} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-base-200">
                      {targetName(r.targetId)}
                      <span className="ml-2 font-mono text-xs text-base-600">
                        {hostOf(r.url)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-base-600">
                      {r.trigger === "schedule" ? "Scheduled" : "Manual"} ·{" "}
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

          {/* ---- next scheduled ---- */}
          <div className="border-t border-base-850 lg:border-t-0">
            <SectionHeader
              title="Up next"
              subtitle="Enabled schedules"
              right={
                <Link
                  href="/schedule"
                  className="text-xs text-ember-400 hover:text-ember-300"
                >
                  Schedule →
                </Link>
              }
            />
            <div className="divide-y divide-base-850">
              {next.map((s) => (
                <Row key={s.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] text-base-200">{s.name}</span>
                    <span className="shrink-0 font-mono text-xs text-ember-400">
                      {formatCountdown(s.nextRunAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-base-600">
                    {targetName(s.targetId)} · {s.cadence}
                  </div>
                </Row>
              ))}
            </div>
          </div>
        </Section>

        <Section flush className="grid lg:grid-cols-2 lg:divide-x lg:divide-base-850">
          {/* ---- defects ---- */}
          <div>
            <SectionHeader
              title="Open defects"
              subtitle="Failures the classifier attributed to the application"
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
              {openDefects.slice(0, 4).map((d) => (
                <Row key={d.id}>
                  <div className="flex items-start gap-2">
                    <Badge tone={d.severity === "critical" ? "danger" : "warn"}>
                      {d.severity}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-base-200">
                      {d.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-base-500">
                      {Math.round(d.confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-xs text-base-600">
                    {targetName(d.targetId)} · {d.surface}
                  </div>
                </Row>
              ))}
            </div>
          </div>

          {/* ---- riskiest untested ---- */}
          <div className="border-t border-base-850 lg:border-t-0">
            <SectionHeader
              title="Riskiest thin coverage"
              subtitle="Surfaces the plan barely touched — ranked by blast radius"
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
              {riskiest.map((c) => (
                <Row key={c.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-base-200">{c.surface}</span>
                    <Badge tone={c.risk === "critical" ? "danger" : "warn"}>
                      {c.scenarios} scenario{c.scenarios === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-base-600">{c.note}</p>
                  <Meter
                    className="mt-2.5 max-w-md"
                    value={Math.min(100, c.scenarios * 12)}
                    tone={c.risk === "critical" ? "danger" : "warn"}
                    label={`${c.surface} coverage`}
                  />
                </Row>
              ))}
            </div>
          </div>
        </Section>
      </PageBody>
    </>
  );
}
