import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { AddProject, RemoveProject } from "@/components/projects/project-actions";
import { Badge, Dot, Meter, Section, type Tone } from "@/components/ui/primitives";
import { RUN_HISTORY, TARGETS } from "@/lib/mock-fleet";
import {
  listProjects,
  projectIdFor,
  projectKey,
  type ProjectEnv,
} from "@/server/project-store";
import { listRuns } from "@/server/run-store";
import { appLabel, formatRelative } from "@/lib/format";

export const metadata = { title: "Projects — The Odyssey" };

// The registry and the run index are both files, and both change while the page is
// open — a run started thirty seconds ago must be on this page when it reloads.
export const dynamic = "force-dynamic";

const ENV_TONE: Record<ProjectEnv, Tone> = {
  production: "danger",
  staging: "info",
  local: "neutral",
};

/**
 * One card. Real projects and the bundled demo ones render through the same shape, so
 * the only difference between them on the page is what the data says — plus the badge
 * that says which is which.
 */
interface ProjectCard {
  id: string;
  name: string;
  url: string;
  env: ProjectEnv;
  authed: boolean;
  prd?: string;
  runs: number;
  running: boolean;
  lastAt?: string;
  coverageScore: number;
  trend: number;
  /** Set only when the run exists on disk — a link that 404s is worse than no link. */
  latestRunId?: string;
  routes?: number;
  scenarios?: number;
  demo: boolean;
  /** Where "Run it" goes. Always somewhere a run can actually be started. */
  launch: string;
  addedByRun?: boolean;
}

export default async function ProjectsPage() {
  const [projects, index] = await Promise.all([listProjects(), listRuns()]);

  const real: ProjectCard[] = projects.map((p) => {
    // `?? projectIdFor(r.url)` picks up runs recorded before the registry existed:
    // they carry no project id, but their URL still says which project they are.
    const runs = index
      .filter((r) => (r.projectId ?? projectIdFor(r.url)) === p.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    // A run that never reached the report stage has no score to show, and averaging a
    // zero into the trend would read as a regression the project did not have.
    const scored = runs.filter((r) => r.coverageScore > 0);
    const latest = runs[0];

    return {
      id: p.id,
      name: p.name,
      url: p.url,
      env: p.env,
      authed: p.authed,
      prd: p.prd,
      runs: runs.length,
      running: runs.some((r) => r.status === "running"),
      lastAt: latest?.startedAt ?? p.lastRunAt,
      coverageScore: scored[0]?.coverageScore ?? 0,
      trend: scored.length > 1 ? scored[0].coverageScore - scored[1].coverageScore : 0,
      latestRunId: latest?.id,
      scenarios: latest?.scenarios,
      demo: false,
      launch: `/new?url=${encodeURIComponent(p.url)}`,
      addedByRun: p.source === "run",
    };
  });

  // The bundled fleet stays — an empty grid teaches a first-time reader nothing about
  // what this page is for — but a demo card drops out the moment a real project covers
  // the same application, so the two can never sit side by side saying different things.
  const realKeys = new Set(projects.map((p) => projectKey(p.url)));
  const demo: ProjectCard[] = TARGETS.filter(
    (t) => !realKeys.has(projectKey(t.url)),
  ).map((t) => ({
    id: t.id,
    name: t.name,
    url: t.url,
    env: t.env,
    authed: t.authed,
    prd: t.prd,
    runs: RUN_HISTORY.filter((r) => r.targetId === t.id).length,
    running: false,
    lastAt: t.lastRunAt,
    coverageScore: t.coverageScore,
    trend: t.trend,
    // Deliberately absent: the seeded run ids are not on disk, so the card offers a
    // run you can start instead of a report that would not open.
    latestRunId: undefined,
    routes: t.routes,
    demo: true,
    launch: t.launch ?? `/new?url=${encodeURIComponent(t.url)}`,
  }));

  const cards = [...real, ...demo];

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Applications under test. A run registers its project automatically; credentials are held per run and redacted from every log line."
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
        <AddProject />

        <div className="grid md:grid-cols-2 xl:grid-cols-3">
          {cards.map((p) => (
            <Section
              key={p.id}
              className="flex flex-col px-6 py-5 md:border-r md:border-base-850"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 truncate text-sm font-semibold text-base-100">
                    {p.running ? <Dot tone="ember" pulse /> : null}
                    {p.name}
                  </h2>
                  <p className="mt-0.5 truncate font-mono text-xs text-base-600">
                    {appLabel(p.url)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone={ENV_TONE[p.env]}>{p.env}</Badge>
                  {p.demo ? null : <RemoveProject id={p.id} name={p.name} />}
                </div>
              </div>

              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {p.demo ? <Badge tone="violet">demo</Badge> : null}
                <Badge tone={p.authed ? "ok" : "neutral"}>
                  {p.authed ? "authenticated" : "no auth"}
                </Badge>
                {p.routes !== undefined ? <Badge>{p.routes} routes</Badge> : null}
                {p.scenarios ? <Badge>{p.scenarios} scenarios</Badge> : null}
                {p.prd ? <Badge tone="violet">PRD linked</Badge> : null}
                {p.addedByRun ? null : p.demo ? null : <Badge>added by hand</Badge>}
              </div>

              <div className="mt-5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-base-500">Coverage score</span>
                  {p.coverageScore > 0 ? (
                    <span className="font-mono text-base-200">
                      {p.coverageScore}
                      <span
                        className={
                          p.trend > 0
                            ? "ml-1 text-ok-400"
                            : p.trend < 0
                              ? "ml-1 text-danger-400"
                              : "ml-1 text-base-600"
                        }
                      >
                        {p.trend > 0 ? "+" : ""}
                        {p.trend}
                      </span>
                    </span>
                  ) : (
                    // No run has scored this project, so the meter shows nothing rather
                    // than a zero that reads as a measured failure.
                    <span className="font-mono text-base-600">not scored yet</span>
                  )}
                </div>
                <Meter
                  className="mt-1.5"
                  value={p.coverageScore}
                  tone={
                    p.coverageScore >= 85 ? "ok" : p.coverageScore >= 70 ? "warn" : "danger"
                  }
                  label={`${p.name} coverage`}
                />
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-base-850 pt-3.5 text-xs text-base-600">
                <span className="truncate">
                  {p.runs} run{p.runs === 1 ? "" : "s"}
                  {p.lastAt ? ` · ${formatRelative(p.lastAt)}` : " · never run"}
                </span>
                {p.latestRunId ? (
                  <Link
                    href={`/runs/${p.latestRunId}`}
                    className="shrink-0 text-ember-400 hover:text-ember-300"
                  >
                    Latest →
                  </Link>
                ) : (
                  <Link
                    href={p.launch}
                    className="shrink-0 text-ember-400 hover:text-ember-300"
                  >
                    Run it →
                  </Link>
                )}
              </div>
            </Section>
          ))}
        </div>
      </PageBody>
    </>
  );
}
