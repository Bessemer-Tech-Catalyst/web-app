import Link from "next/link";
import {
  Badge,
  Empty,
  Row,
  Section,
  SectionHeader,
  Stat,
  SplitGrid,
} from "@/components/ui/primitives";
import { listRuns, getRunState } from "@/server/run-store";
import { listProjects } from "@/server/project-store";
import { formatDuration, formatUsd, hostOf } from "@/lib/format";

export const dynamic = "force-dynamic";

interface SiteMetrics {
  url: string;
  projectId: string;
  runCount: number;
  avgCoverage: number;
  avgPassRate: number;
  totalBugs: number;
  latestRunId: string;
  latestRunTime: string;
}

export default async function SitesPage() {
  const runs = await listRuns();
  const runStates = await Promise.all(
    runs.map(async (r) => ({ ...r, state: await getRunState(r.id) }))
  );

  // Group by URL/project
  const siteMap = new Map<string, SiteMetrics>();

  for (const run of runStates) {
    if (!run.state?.report) continue;

    const key = run.url;
    if (!siteMap.has(key)) {
      siteMap.set(key, {
        url: run.url,
        projectId: run.projectId || "",
        runCount: 0,
        avgCoverage: 0,
        avgPassRate: 0,
        totalBugs: 0,
        latestRunId: run.id,
        latestRunTime: run.startedAt,
      });
    }

    const metrics = siteMap.get(key)!;
    metrics.runCount++;
    metrics.avgCoverage += run.state.report.coverageScore;
    const passRate = run.state.report.passed + run.state.report.healed;
    const total = run.state.report.passed + run.state.report.failed + run.state.report.healed;
    metrics.avgPassRate += total > 0 ? (passRate / total) * 100 : 100;
    metrics.totalBugs += run.state.report.bugs.length;

    // Update to latest run
    if (run.startedAt > metrics.latestRunTime) {
      metrics.latestRunId = run.id;
      metrics.latestRunTime = run.startedAt;
    }
  }

  // Calculate averages
  const sites = Array.from(siteMap.values()).map((m) => ({
    ...m,
    avgCoverage: Math.round(m.avgCoverage / m.runCount),
    avgPassRate: Math.round(m.avgPassRate / m.runCount),
  }));

  const totalSites = sites.length;
  const totalRuns = runs.length;
  const avgCoverageAll = sites.length
    ? Math.round(sites.reduce((n, s) => n + s.avgCoverage, 0) / sites.length)
    : 0;
  const totalBugsAll = sites.reduce((n, s) => n + s.totalBugs, 0);

  return (
    <div className="min-h-full">
      <header className="border-b border-base-850 bg-base-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <h1 className="text-2xl font-semibold text-base-100">Sites Dashboard</h1>
          <p className="mt-1 text-sm text-base-500">Overview of all tested applications and their metrics</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-7">
        {/* Fleet statistics */}
        <Section className="mb-7">
          <SectionHeader title="Fleet Overview" />
          <SplitGrid cols={4}>
            <Stat label="Tracked Sites" value={totalSites} hint="unique URLs" />
            <Stat label="Total Runs" value={totalRuns} hint="test suites" />
            <Stat
              label="Avg Coverage"
              value={avgCoverageAll}
              tone={avgCoverageAll >= 85 ? "ok" : "warn"}
              hint="across all sites"
            />
            <Stat
              label="Total Bugs"
              value={totalBugsAll}
              tone={totalBugsAll > 0 ? "danger" : "ok"}
              hint="filed across all runs"
            />
          </SplitGrid>
        </Section>

        {/* Sites list */}
        <Section>
          <SectionHeader
            title="Tested Sites"
            subtitle="Sorted by latest run"
            right={
              <Link href="/runs" className="text-xs text-ember-400 hover:text-ember-300">
                All runs →
              </Link>
            }
          />
          {sites.length === 0 ? (
            <Empty>No test runs yet</Empty>
          ) : (
            <ul className="divide-y divide-base-850">
              {sites
                .sort((a, b) => b.latestRunTime.localeCompare(a.latestRunTime))
                .map((site) => (
                  <li key={site.url} className="px-6 py-4">
                    <Link
                      href={`/runs/${site.latestRunId}`}
                      className="block transition hover:bg-base-900/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm text-base-200">{hostOf(site.url)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge
                              tone={site.avgCoverage >= 85 ? "ok" : "warn"}
                              mono
                            >
                              {site.avgCoverage}% coverage
                            </Badge>
                            <Badge
                              tone={site.avgPassRate >= 80 ? "ok" : "warn"}
                              mono
                            >
                              {Math.round(site.avgPassRate)}% pass rate
                            </Badge>
                            <Badge tone={site.totalBugs > 0 ? "danger" : "ok"} mono>
                              {site.totalBugs} bug{site.totalBugs === 1 ? "" : "s"}
                            </Badge>
                            <span className="text-xs text-base-600">
                              {site.runCount} run{site.runCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-xs text-base-400">{site.latestRunId}</div>
                          <Link
                            href={`/runs?compare=${site.latestRunId}`}
                            className="mt-2 block text-xs text-ember-400 hover:text-ember-300"
                          >
                            View →
                          </Link>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
