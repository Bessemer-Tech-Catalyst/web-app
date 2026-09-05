import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, Section, SectionHeader, Stat, SplitGrid } from "@/components/ui/primitives";
import { getRunState } from "@/server/run-store";
import { formatDuration, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ old?: string; new?: string }>;
}) {
  const params = await searchParams;
  const oldId = params.old;
  const newId = params.new;

  if (!oldId || !newId) {
    return (
      <main className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-base-300">Missing run IDs for comparison</p>
          <p className="mt-1 font-mono text-xs text-base-500">?old=runId&amp;new=runId</p>
        </div>
      </main>
    );
  }

  const oldState = await getRunState(oldId);
  const newState = await getRunState(newId);

  if (!oldState?.report || !newState?.report) {
    notFound();
  }

  const oldReport = oldState.report;
  const newReport = newState.report;

  const coverageDelta = newReport.coverageScore - oldReport.coverageScore;
  const bugsDelta = newReport.bugs.length - oldReport.bugs.length;
  const passDelta = newReport.passed - oldReport.passed;
  const failDelta = newReport.failed - oldReport.failed;
  const healDelta = newReport.healed - oldReport.healed;

  return (
    <main className="min-h-full">
      <header className="border-b border-base-850 bg-base-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/runs"
              className="rounded-md border border-base-800 px-2.5 py-1 text-xs text-base-400 transition hover:text-base-100"
            >
              ← Back to runs
            </Link>
            <h1 className="text-lg font-semibold text-base-100">Report Comparison</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-7">
        {/* Comparison headline */}
        <Section className="mb-6">
          <SectionHeader
            title="Metrics Delta"
            subtitle={`Old: ${oldId} → New: ${newId}`}
          />
          <SplitGrid cols={4}>
            <div className="text-center">
              <div className={`text-lg font-semibold ${coverageDelta >= 0 ? "text-ok-400" : "text-danger-400"}`}>
                {coverageDelta > 0 ? "+" : ""}{coverageDelta}
              </div>
              <div className="mt-1 text-xs text-base-500">Coverage Score</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${bugsDelta <= 0 ? "text-ok-400" : "text-danger-400"}`}>
                {bugsDelta > 0 ? "+" : ""}{bugsDelta}
              </div>
              <div className="mt-1 text-xs text-base-500">Bugs Found</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${passDelta >= 0 ? "text-ok-400" : "text-danger-400"}`}>
                {passDelta > 0 ? "+" : ""}{passDelta}
              </div>
              <div className="mt-1 text-xs text-base-500">Passed Tests</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${failDelta <= 0 ? "text-ok-400" : "text-danger-400"}`}>
                {failDelta > 0 ? "+" : ""}{failDelta}
              </div>
              <div className="mt-1 text-xs text-base-500">Failed Tests</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${healDelta >= 0 ? "text-ok-400" : "text-neutral-400"}`}>
                {healDelta > 0 ? "+" : ""}{healDelta}
              </div>
              <div className="mt-1 text-xs text-base-500">Healed</div>
            </div>
          </SplitGrid>
        </Section>

        {/* Side by side comparison */}
        <div className="grid gap-6 lg:grid-cols-2 lg:divide-x lg:divide-base-850">
          {/* Old report */}
          <Section>
            <SectionHeader title="Old Report" subtitle={oldId} />
            <div className="space-y-3 px-6 py-4">
              <div>
                <div className="text-xs text-base-600">Coverage</div>
                <div className="text-lg font-semibold text-base-100">{oldReport.coverageScore}</div>
              </div>
              <div>
                <div className="text-xs text-base-600">Bugs Filed</div>
                <div className="text-lg font-semibold text-base-100">{oldReport.bugs.length}</div>
              </div>
              <div>
                <div className="text-xs text-base-600">Passed / Failed</div>
                <div className="text-lg font-semibold text-base-100">
                  {oldReport.passed} / {oldReport.failed}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Duration</div>
                <div className="text-lg font-semibold text-base-100">
                  {formatDuration(oldReport.durationMs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Cost</div>
                <div className="text-lg font-semibold text-base-100">
                  {formatUsd(oldReport.costUsd)}
                </div>
              </div>
            </div>
          </Section>

          {/* New report */}
          <Section>
            <SectionHeader title="New Report" subtitle={newId} />
            <div className="space-y-3 px-6 py-4">
              <div>
                <div className="text-xs text-base-600">Coverage</div>
                <div className="text-lg font-semibold text-base-100">{newReport.coverageScore}</div>
              </div>
              <div>
                <div className="text-xs text-base-600">Bugs Filed</div>
                <div className="text-lg font-semibold text-base-100">{newReport.bugs.length}</div>
              </div>
              <div>
                <div className="text-xs text-base-600">Passed / Failed</div>
                <div className="text-lg font-semibold text-base-100">
                  {newReport.passed} / {newReport.failed}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Duration</div>
                <div className="text-lg font-semibold text-base-100">
                  {formatDuration(newReport.durationMs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-base-600">Cost</div>
                <div className="text-lg font-semibold text-base-100">
                  {formatUsd(newReport.costUsd)}
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* New bugs */}
        {newReport.bugs.length > oldReport.bugs.length && (
          <Section className="mt-6">
            <SectionHeader
              title="New Bugs Found"
              subtitle={`${newReport.bugs.length - oldReport.bugs.length} additional issues`}
            />
            <ul className="divide-y divide-base-850">
              {newReport.bugs.slice(oldReport.bugs.length).map((bug) => (
                <li key={bug.id} className="px-6 py-3">
                  <div className="flex items-start gap-2">
                    <Badge tone={bug.severity === "critical" ? "danger" : "warn"}>
                      {bug.severity}
                    </Badge>
                    <div>
                      <p className="text-sm text-base-200">{bug.title}</p>
                      <p className="mt-0.5 text-xs text-base-500">Test: {bug.testId}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </main>
  );
}
