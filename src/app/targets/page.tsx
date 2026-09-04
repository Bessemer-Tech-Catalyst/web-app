import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Card, Meter, type Tone } from "@/components/ui/primitives";
import { RUN_HISTORY, TARGETS, type Target } from "@/lib/mock-fleet";
import { formatRelative, hostOf } from "@/lib/format";

export const metadata = { title: "Targets — The Odyssey" };

const ENV_TONE: Record<Target["env"], Tone> = {
  production: "danger",
  staging: "info",
  local: "neutral",
};

export default function TargetsPage() {
  return (
    <>
      <PageHeader
        title="Targets"
        subtitle="Applications under test. Credentials are held per run and redacted from every log line."
        actions={
          <Link
            href="/new"
            className="rounded-lg border border-base-800 px-3.5 py-2 text-[13px] text-base-300 transition hover:border-base-700 hover:text-base-100"
          >
            Add target
          </Link>
        }
      />

      <PageBody>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TARGETS.map((t) => {
            const runs = RUN_HISTORY.filter((r) => r.targetId === t.id);
            return (
              <Card key={t.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-base-100">
                      {t.name}
                    </h2>
                    <p className="mt-0.5 truncate font-mono text-xs text-base-600">
                      {hostOf(t.url)}
                    </p>
                  </div>
                  <Badge tone={ENV_TONE[t.env]}>{t.env}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={t.authed ? "ok" : "neutral"}>
                    {t.authed ? "authenticated" : "no auth"}
                  </Badge>
                  <Badge>{t.routes} routes</Badge>
                  {t.prd ? <Badge tone="violet">PRD linked</Badge> : null}
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-base-500">Coverage score</span>
                    <span className="font-mono text-base-200">
                      {t.coverageScore}
                      <span
                        className={
                          t.trend > 0
                            ? "ml-1 text-ok-400"
                            : t.trend < 0
                              ? "ml-1 text-danger-400"
                              : "ml-1 text-base-600"
                        }
                      >
                        {t.trend > 0 ? "+" : ""}
                        {t.trend}
                      </span>
                    </span>
                  </div>
                  <Meter
                    className="mt-1.5"
                    value={t.coverageScore}
                    tone={t.coverageScore >= 85 ? "ok" : t.coverageScore >= 70 ? "warn" : "danger"}
                    label={`${t.name} coverage`}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-base-800 pt-3 text-xs text-base-600">
                  <span>
                    {runs.length} run{runs.length === 1 ? "" : "s"} ·{" "}
                    {formatRelative(t.lastRunAt)}
                  </span>
                  {runs[0] ? (
                    <Link
                      href={`/runs/${runs[0].id}`}
                      className="text-ember-400 hover:text-ember-300"
                    >
                      Latest →
                    </Link>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
