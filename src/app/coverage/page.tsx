import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Meter, Section, SectionHeader, Stat, type Tone } from "@/components/ui/primitives";
import { COVERAGE, TARGETS, targetName } from "@/lib/mock-fleet";
import type { Priority } from "@/lib/types";

export const metadata = { title: "Coverage — The Odyssey" };

const RISK_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "warn",
  medium: "info",
  low: "ok",
};

export default function CoveragePage() {
  const tested = COVERAGE.filter((c) => c.scenarios > 0);
  const untested = COVERAGE.filter((c) => c.scenarios === 0);
  const totalScenarios = COVERAGE.reduce((n, c) => n + c.scenarios, 0);
  const weightedPass =
    tested.reduce((n, c) => n + c.passRate * c.scenarios, 0) /
    Math.max(1, tested.reduce((n, c) => n + c.scenarios, 0));

  return (
    <>
      <PageHeader
        title="Coverage"
        subtitle="What the pipeline has exercised — and, more usefully, what it never reached."
      />

      <PageBody>
        <Section className="grid divide-y divide-base-850 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Stat label="Surfaces mapped" value={COVERAGE.length} hint="Across all targets" />
          <Stat label="Scenarios" value={totalScenarios} hint="Generated and executed" />
          <Stat
            label="Weighted pass rate"
            value={`${Math.round(weightedPass * 100)}%`}
            tone={weightedPass > 0.85 ? "ok" : "warn"}
            hint="Passing tests over tests run"
          />
          <Stat
            label="Never planned"
            value={untested.length}
            tone={untested.length ? "danger" : "ok"}
            hint="Surfaces with zero scenarios"
          />
        </Section>

        <Section>
          <SectionHeader
            title="By surface"
            subtitle="Coverage depth, pass rate and the residual risk of what's missing"
          />
          <div className="divide-y divide-base-850">
            {[...COVERAGE]
              .sort((a, b) => a.scenarios - b.scenarios)
              .map((c) => (
                <div key={c.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-base-100">{c.surface}</span>
                      <span className="text-xs text-base-600">
                        {targetName(c.targetId)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={RISK_TONE[c.risk]}>{c.risk} risk</Badge>
                      <span className="font-mono text-xs text-base-500">
                        {c.scenarios} scenario{c.scenarios === 1 ? "" : "s"}
                      </span>
                      <span className="w-10 text-right font-mono text-xs text-base-400">
                        {c.scenarios ? `${Math.round(c.passRate * 100)}%` : "—"}
                      </span>
                    </div>
                  </div>
                  <Meter
                    className="mt-2.5 max-w-2xl"
                    value={c.scenarios ? c.passRate * 100 : 3}
                    tone={c.scenarios ? RISK_TONE[c.risk] : "danger"}
                    label={`${c.surface} pass rate`}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-base-500">{c.note}</p>
                </div>
              ))}
          </div>
        </Section>

        <Section>
          <SectionHeader
            title="Per target"
            subtitle="Latest critic score and its direction since the previous run"
          />
          <div className="divide-y divide-base-850">
            {TARGETS.map((t) => (
              <div key={t.id} className="flex items-center gap-4 px-6 py-3.5">
                <span className="w-40 shrink-0 truncate text-[13px] text-base-200">
                  {t.name}
                </span>
                <Meter
                  className="max-w-xl"
                  value={t.coverageScore}
                  tone={t.coverageScore >= 85 ? "ok" : t.coverageScore >= 70 ? "warn" : "danger"}
                  label={`${t.name} coverage score`}
                />
                <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-base-300">
                  {t.coverageScore}
                </span>
                <span
                  className={`w-10 shrink-0 text-right font-mono text-xs tabular-nums ${
                    t.trend > 0
                      ? "text-ok-400"
                      : t.trend < 0
                        ? "text-danger-400"
                        : "text-base-600"
                  }`}
                >
                  {t.trend > 0 ? "+" : ""}
                  {t.trend}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </PageBody>
    </>
  );
}
