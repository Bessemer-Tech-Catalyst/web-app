import Link from "next/link";
import {
  Badge,
  Section,
  SectionHeader,
  Code,
  Empty,
  Meter,
  Stat,
  type Tone,
} from "@/components/ui/primitives";
import {
  TRIAGE_META,
  type Priority,
  type TestQualityReport,
  type TestStatus,
} from "@/lib/types";
import { cn, formatDuration, formatUsd, hostOf } from "@/lib/format";

const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "warn",
  medium: "info",
  low: "neutral",
};

const STATUS_TONE: Record<TestStatus, Tone> = {
  passed: "ok",
  healed: "ember",
  failed: "danger",
  quarantined: "violet",
  running: "info",
  pending: "neutral",
};

export function ReportView({
  runId,
  report,
}: {
  runId: string;
  report: TestQualityReport;
}) {
  const executed = report.results.filter((r) => r.status !== "quarantined");
  const green = report.passed + report.healed;
  const passRate = executed.length ? Math.round((green / executed.length) * 100) : 0;

  return (
    <main className="min-h-full">
      <header className="border-b border-base-850 bg-base-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-3">
          <Link
            href={`/runs/${runId}`}
            className="rounded-md border border-base-800 px-2.5 py-1 text-xs text-base-400 transition hover:text-base-100"
          >
            ← Back to the run
          </Link>
          <div className="ml-auto flex items-center gap-2 font-mono text-xs text-base-500">
            <span>{hostOf(report.url)}</span>
            <Badge mono>{runId}</Badge>
          </div>
        </div>
      </header>

      <div className="pb-20">
        {/* ---------- headline ---------- */}
        <div className="border-b border-base-850 px-6 py-7">
          <h1 className="text-2xl font-semibold tracking-tight text-base-100">
            Test quality report
          </h1>
          <p className="mt-1.5 text-sm text-base-500">
            {report.scenariosPlanned} scenarios planned · {report.scenariosGenerated}{" "}
            generated · {report.replans} re-plan · {report.healAttempts} heal attempts ·{" "}
            {formatDuration(report.durationMs)} · {formatUsd(report.costUsd)}
          </p>
        </div>

        <Section className="grid divide-base-850 sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
          <Stat
            label="Coverage"
            value={`${report.coverageScore}`}
            hint="after 1 re-plan"
            tone={report.coverageScore >= 85 ? "ok" : "warn"}
          />
          <Stat
            label="Pass rate"
            value={`${passRate}%`}
            hint={`${green} of ${executed.length} executed`}
            tone={passRate >= 80 ? "ok" : "warn"}
          />
          <Stat label="Healed" value={report.healed} hint="locators repaired" tone="ember" />
          <Stat
            label="Bugs filed"
            value={report.bugs.length}
            hint="not healed away"
            tone="danger"
          />
          <Stat
            label="Quarantined"
            value={report.scenariosQuarantined}
            hint="unproven selectors"
            tone="violet"
          />
          <Stat
            label="Residual risk"
            value={report.risks.filter((r) => r.risk === "critical").length}
            hint="critical untested"
            tone="warn"
          />
        </Section>

        {/* ---------- bugs ---------- */}
        <Section>
          <SectionHeader
            title="Genuine application defects"
            subtitle="Classified as app bugs, so the Healer was deliberately withheld and these tests stay red"
            right={<Badge tone="danger">{report.bugs.length} filed</Badge>}
          />
          {report.bugs.length === 0 ? (
            <Empty>No application defects detected</Empty>
          ) : (
            <ul className="divide-y divide-base-850">
              {report.bugs.map((b) => (
                <li key={b.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[b.severity]}>{b.severity}</Badge>
                    <h3 className="text-sm font-medium text-base-100">{b.title}</h3>
                    <span className="ml-auto font-mono text-[11px] text-base-600">
                      {b.testId}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {b.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="rounded border border-base-850 bg-base-950/60 px-2 py-1.5 font-mono text-[11px] leading-4 text-base-400"
                      >
                        {e.summary}
                        {e.detail ? (
                          <span className="mt-0.5 block text-base-600">{e.detail}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---------- scenarios ---------- */}
        <Section>
          <SectionHeader
            title="Scenarios covered"
            subtitle="Every planned flow and what happened to it"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="border-b border-base-850 text-[11px] uppercase tracking-wider text-base-600">
                  <th className="px-4 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 font-medium">Flow</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-4 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-850">
                {report.scenarios.map((s) => {
                  const result = report.results.find(
                    (r) => r.testId === `t-${s.id}` || r.testId === `q-${s.id}`,
                  );
                  const status = result?.status ?? "pending";
                  const triage = report.triage.find((t) => t.testId === `t-${s.id}`);
                  return (
                    <tr key={s.id} className="align-top">
                      <td className="px-6 py-2.5">
                        <span className="text-[13px] text-base-200">{s.title}</span>
                        {triage ? (
                          <span className="mt-1 block text-[11px] text-base-500">
                            {TRIAGE_META[triage.verdict].label} ·{" "}
                            {TRIAGE_META[triage.verdict].action}
                          </span>
                        ) : null}
                        {status === "quarantined" && result?.error ? (
                          <span className="mt-1 block text-[11px] leading-relaxed text-violet-500/80">
                            {result.error}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-base-400">{s.flow}</td>
                      <td className="px-3 py-2.5">
                        <Badge>{s.kind}</Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {s.addedByCritique ? (
                          <Badge tone="ember">critic</Badge>
                        ) : (
                          <Badge>planner</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                      </td>
                      <td className="px-6 py-2.5 text-right font-mono text-[11px] text-base-500">
                        {result?.durationMs ? formatDuration(result.durationMs) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------- healer ---------- */}
        <Section>
          <SectionHeader
            title="Healer actions"
            subtitle="Locators and waits may change. Assertions may not — patches that weaken one are rejected."
            right={<Badge tone="ember">{report.heals.length} attempts</Badge>}
          />
          <ul className="divide-y divide-base-850">
            {report.heals.map((h) => (
              <li key={`${h.testId}-${h.attempt}`} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={h.outcome === "rejected" ? "danger" : "ember"}>
                    {h.outcome}
                  </Badge>
                  <span className="font-mono text-[11px] text-base-600">
                    {h.testId} · attempt {h.attempt}
                  </span>
                  <Badge tone={h.assertionsIntact ? "ok" : "danger"}>
                    {h.assertionsIntact ? "assertions intact" : "assertion guard tripped"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-base-400">
                  {h.summary}
                </p>
                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <Code tone="remove">{h.before}</Code>
                  <Code tone={h.outcome === "rejected" ? "remove" : "add"}>{h.after}</Code>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------- risk + gaps ---------- */}
        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-base-850">
          <Section>
            <SectionHeader
              title="Untested flow risk"
              subtitle="Surfaces we found but never exercised, ranked by what it costs you"
            />
            <ul className="divide-y divide-base-850">
              {report.risks.map((r) => (
                <li key={r.id} className="px-6 py-3.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={PRIORITY_TONE[r.risk]}>{r.risk}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-base-200">
                      {r.surface}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-base-400">
                      {r.score}
                    </span>
                  </div>
                  <Meter
                    className="mt-2.5 max-w-md"
                    value={r.score}
                    tone={PRIORITY_TONE[r.risk]}
                    label={`Risk score for ${r.surface}`}
                  />
                  <ul className="mt-2 space-y-0.5">
                    {r.reasons.map((reason, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-base-500">
                        · {reason}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <div>
            <Section>
              <SectionHeader
                title="Remaining coverage gaps"
                subtitle="Known and accepted — not silently dropped"
              />
              {report.remainingGaps.length === 0 ? (
                <Empty>No residual gaps</Empty>
              ) : (
                <ul className="divide-y divide-base-850">
                  {report.remainingGaps.map((g) => (
                    <li key={g.id} className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={PRIORITY_TONE[g.severity]}>{g.severity}</Badge>
                        <span className="text-[13px] text-base-200">{g.title}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-base-500">
                        {g.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {report.prd ? (
              <Section>
                <SectionHeader
                  title="PRD traceability"
                  subtitle="Every stated requirement, and whether a test proves it"
                  right={
                    <Badge tone="warn">
                      {report.prd.filter((r) => !r.covered).length} uncovered
                    </Badge>
                  }
                />
                <ul className="divide-y divide-base-850">
                  {report.prd.map((r) => (
                    <li key={r.id} className="flex items-start gap-2.5 px-6 py-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                          r.covered
                            ? "border-ok-500/40 bg-ok-500/12 text-ok-400"
                            : "border-danger-500/40 bg-danger-500/12 text-danger-400",
                        )}
                      >
                        {r.covered ? "✓" : "✕"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-base-200">{r.text}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-base-600">
                          {r.id}
                          {r.coveredBy.length
                            ? ` → ${r.coveredBy.join(", ")}`
                            : " → no coverage"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : (
              <Section className="p-4">
                <p className="text-xs leading-relaxed text-base-500">
                  No PRD was supplied for this run. Attach one on the launcher to get a
                  requirement-by-requirement traceability matrix showing exactly which
                  stated requirements have no test behind them.
                </p>
              </Section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
