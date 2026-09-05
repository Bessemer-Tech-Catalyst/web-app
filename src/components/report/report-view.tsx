import Link from "next/link";
import {
  Badge,
  Section,
  SectionHeader,
  Code,
  Empty,
  Meter,
  Stat,
  StatBand,
  type Tone,
} from "@/components/ui/primitives";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TRIAGE_META,
  type OrchestratorEvent,
  type PrdCoverage,
  type Priority,
  type SurfaceCoverage,
  type TestQualityReport,
  type TestStatus,
} from "@/lib/types";
import { resultFor, triageFor } from "@/lib/report-join";
import { cn, formatDuration, formatUsd, hostOf } from "@/lib/format";

type ArtifactEvent = Extract<OrchestratorEvent, { type: "artifact" }>;

/**
 * The four-way answer the PRD gate produces.
 *
 * A tick that means "a scenario mentions this" and a tick that means "a test proved
 * this" are different claims, and collapsing them to a checkbox is what makes the naive
 * version of this table actively misleading.
 */
const PRD_META: Record<PrdCoverage, { mark: string; label: string; tone: Tone }> = {
  proven: { mark: "✓", label: "proven by a passing test", tone: "ok" },
  exercised: { mark: "!", label: "test ran and is red", tone: "warn" },
  "planned-only": { mark: "◻", label: "planned — no test ever ran", tone: "violet" },
  uncovered: { mark: "✕", label: "nothing in the plan covers it", tone: "danger" },
};

const SURFACE_TONE: Record<SurfaceCoverage["status"], Tone> = {
  exercised: "ok",
  "planned-only": "violet",
  untested: "warn",
};

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

/**
 * The document is a column, not a canvas.
 *
 * Every band on this page is a rule-separated section inside one measure, so a heading,
 * a table cell and a list row all begin on the same vertical line and no sentence is set
 * to the width of a 27-inch monitor.
 */
const MEASURE = "mx-auto w-full max-w-[1180px]";

export function ReportView({
  runId,
  report,
  artifacts = [],
}: {
  runId: string;
  report: TestQualityReport;
  /** Emitted during the run; the report cites them, this page shows them. */
  artifacts?: ArtifactEvent[];
}) {
  const executed = report.results.filter((r) => r.status !== "quarantined");
  const green = report.passed + report.healed;
  const passRate = executed.length ? Math.round((green / executed.length) * 100) : 0;

  const nav = [
    { id: "summary", label: "Summary" },
    { id: "defects", label: "Defects" },
    { id: "scenarios", label: "Scenarios" },
    { id: "healer", label: "Healer" },
    { id: "risk", label: "Risk" },
    { id: "gaps", label: "Gaps" },
    ...(report.prd ? [{ id: "prd", label: "PRD" }] : []),
    ...(artifacts.length ? [{ id: "evidence", label: "Evidence" }] : []),
    ...(report.surfaces?.length ? [{ id: "coverage", label: "Coverage working" }] : []),
  ];

  return (
    <main className="min-h-full">
      {/* ---------- sticky document header ----------
          This report is five screens tall on a real run. A header that scrolls away at
          the top of it leaves the reader with no way back and no idea which of nine
          sections they are standing in, so it stays, and it carries the jump nav. */}
      <header className="sticky top-0 z-20 border-b border-base-850 bg-base-950/85 backdrop-blur">
        <div className={cn("flex flex-wrap items-center gap-3 px-6 pt-3 pb-2.5", MEASURE)}>
          <Link
            href={`/runs/${runId}`}
            className="rounded-md border border-base-800 px-2.5 py-1 text-xs text-base-400 transition hover:border-base-700 hover:text-base-100"
          >
            ← Back to the run
          </Link>
          <span aria-hidden className="hidden h-4 w-px bg-base-850 sm:block" />
          <span className="hidden text-[13px] font-semibold tracking-tight text-base-100 sm:block">
            Test quality report
          </span>
          <div className="ml-auto flex items-center gap-2 font-mono text-[11px] text-base-500">
            <span className="hidden sm:block">{hostOf(report.url)}</span>
            <Badge mono>{runId}</Badge>
            <Link
              href={`/runs/${runId}/rerun`}
              className="rounded-md bg-ember-500/20 px-2.5 py-1 text-ember-400 transition hover:bg-ember-500/30"
            >
              ⟳ Rerun
            </Link>
            <Link
              href={`/runs/compare?old=run_example&new=${runId}`}
              className="rounded-md bg-info-500/20 px-2.5 py-1 text-info-400 transition hover:bg-info-500/30"
            >
              Compare
            </Link>
          </div>
        </div>
        <nav
          aria-label="Report sections"
          className={cn("flex gap-1 overflow-x-auto px-5 pb-2", MEASURE)}
        >
          {nav.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] text-base-500 transition hover:bg-base-850/70 hover:text-base-200"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <div className={cn("pb-24", MEASURE)}>
        {/* ---------- headline ---------- */}
        <Section id="summary" className="px-6 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-base-100">
            Test quality report
          </h1>
          <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-base-400">
            What this run planned, what it proved, and — the part a pass rate alone never
            says — what it left untested.
          </p>
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label="Scenarios" value={`${report.scenariosPlanned} planned`} />
            <Fact label="Generated" value={`${report.scenariosGenerated}`} />
            <Fact
              label="Re-plans"
              value={`${report.replans}`}
              hint={report.replans ? "critic sent the plan back" : "plan passed first time"}
            />
            <Fact label="Heal attempts" value={`${report.healAttempts}`} />
            <Fact label="Duration" value={formatDuration(report.durationMs)} />
            <Fact label="Spend" value={formatUsd(report.costUsd)} />
          </dl>
        </Section>

        <Section>
          <StatBand>
            <Stat
              label="Coverage"
              value={`${report.coverageScore}`}
              // Was the literal "after 1 re-plan", printed under every run whatever
              // happened. A number's caption is part of the number.
              hint={report.replans === 1 ? "after 1 re-plan" : `after ${report.replans} re-plans`}
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
          </StatBand>
        </Section>

        {/* ---------- bugs ---------- */}
        <Section id="defects">
          <SectionHeader
            title="Genuine application defects"
            subtitle="Classified as app bugs, so the Healer was deliberately withheld and these tests stay red"
            right={
              <Badge tone={report.bugs.length ? "danger" : "neutral"}>
                {report.bugs.length} filed
              </Badge>
            }
          />
          {report.bugs.length === 0 ? (
            <Empty inline>No application defects detected</Empty>
          ) : (
            <ScrollArea maxHeight="30rem">
              <ul className="divide-y divide-base-850">
                {report.bugs.map((b) => (
                  <li key={b.id} className="px-6 py-3.5">
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
            </ScrollArea>
          )}
        </Section>

        {/* ---------- scenarios ---------- */}
        <Section id="scenarios">
          <SectionHeader
            title="Scenarios covered"
            subtitle="Every planned flow and what happened to it"
            right={<Badge mono>{report.scenarios.length}</Badge>}
          />
          <ScrollArea maxHeight="34rem" className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-base-950">
                <tr className="text-[11px] uppercase tracking-wider text-base-600 [&>th]:border-b [&>th]:border-base-850">
                  <th className="px-6 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 font-medium">Flow</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-6 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-850">
                {report.scenarios.map((s) => {
                  // Through `report-join`, not by string equality. The real Generator
                  // names a test after its scenario and the fixtures prefix it; this
                  // table used to match only the prefix, so every live run rendered as
                  // `pending` from top to bottom.
                  const result = resultFor(report.results, s.id);
                  const status = result?.status ?? "pending";
                  const triage = triageFor(report.triage, s.id);
                  return (
                    <tr key={s.id} className="align-top transition-colors hover:bg-base-900/40">
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
          </ScrollArea>
        </Section>

        {/* ---------- healer ---------- */}
        <Section id="healer">
          <SectionHeader
            title="Healer actions"
            subtitle="Locators and waits may change. Assertions may not — patches that weaken one are rejected."
            right={
              <Badge tone={report.heals.length ? "ember" : "neutral"}>
                {report.heals.length} attempts
              </Badge>
            }
          />
          {report.heals.length === 0 ? (
            <Empty inline>The Healer was never called on this run</Empty>
          ) : (
            <ScrollArea maxHeight="34rem">
              <ul className="divide-y divide-base-850">
                {report.heals.map((h) => (
                  <li key={`${h.testId}-${h.attempt}`} className="px-6 py-3.5">
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
                    <p className="mt-1.5 max-w-[80ch] text-[13px] leading-relaxed text-base-400">
                      {h.summary}
                    </p>
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      <Code tone="remove">{h.before}</Code>
                      <Code tone={h.outcome === "rejected" ? "remove" : "add"}>{h.after}</Code>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </Section>

        {/* ---------- risk + gaps ----------
            Two ledgers of the same thing — what has no evidence behind it — so they sit
            side by side and each keeps its own scrollbar. Stacking them, or letting one
            of them set the height of the pair, was what left a column of empty page
            running beside a list four screens long.

            They pair up only when both have rows in them: a grid column stretches to its
            neighbour, so one empty ledger beside a full one is a screen of blank page
            with a single line of grey text at the top of it. */}
        <div
          className={cn(
            "grid border-b border-base-850",
            "divide-y divide-base-850",
            report.risks.length > 0 &&
              report.remainingGaps.length > 0 &&
              "lg:grid-cols-2 lg:divide-x lg:divide-y-0",
          )}
        >
          <Section flush id="risk">
            <SectionHeader
              title="Untested flow risk"
              subtitle="Surfaces we found and produced no evidence about, scored on what they cost you"
              right={
                report.risks.length ? (
                  <Badge tone="warn">{report.risks.length} ranked</Badge>
                ) : undefined
              }
            />
            {report.risks.length === 0 ? (
              <Empty inline>
                Every surface the crawl found was exercised by a test that ran
              </Empty>
            ) : (
              <ScrollArea maxHeight="28rem">
                <ul className="divide-y divide-base-850">
                  {report.risks.map((r) => (
                    <li key={r.id} className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={PRIORITY_TONE[r.risk]}>{r.risk}</Badge>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-base-200">
                          {r.surface}
                        </span>
                        {/* The sharpest row in the ledger: the plan wanted this and the run
                            never got it, which ranks above a surface nobody thought of. */}
                        {r.status === "planned-only" ? (
                          <Badge tone="violet">planned, never ran</Badge>
                        ) : null}
                        <span
                          className="font-mono text-xs tabular-nums text-base-400"
                          title={
                            r.priorScore !== undefined
                              ? `Computed ${r.priorScore} from fixed factors; adjusted on review`
                              : "Computed from fixed factors — no model adjusted it"
                          }
                        >
                          {r.score}
                          {r.priorScore !== undefined ? (
                            <span className="ml-1 text-base-600">was {r.priorScore}</span>
                          ) : null}
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
              </ScrollArea>
            )}
          </Section>

          <Section flush id="gaps">
            <SectionHeader
              title="Remaining coverage gaps"
              subtitle="Known and accepted — not silently dropped"
              right={
                report.remainingGaps.length ? (
                  <Badge mono>{report.remainingGaps.length}</Badge>
                ) : undefined
              }
            />
            {report.remainingGaps.length === 0 ? (
              <Empty inline>No residual gaps</Empty>
            ) : (
              <ScrollArea maxHeight="28rem">
                <ul className="divide-y divide-base-850">
                  {report.remainingGaps.map((g) => (
                    <li key={g.id} className="px-6 py-3.5">
                      <div className="flex max-w-[86ch] items-start gap-2">
                        <Badge tone={PRIORITY_TONE[g.severity]}>{g.severity}</Badge>
                        <span className="text-[13px] leading-snug text-base-200">
                          {g.title}
                        </span>
                      </div>
                      <p className="mt-1.5 max-w-[86ch] text-[11px] leading-relaxed text-base-500">
                        {g.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </Section>
        </div>

        {/* ---------- PRD ---------- */}
        <PrdSection report={report} />

        {/* ---------- evidence ---------- */}
        <EvidenceSection runId={runId} artifacts={artifacts} />

        {/* ---------- coverage working ---------- */}
        <CoverageSection surfaces={report.surfaces} />
      </div>
    </main>
  );
}

/** One figure in the run's masthead — a label above the number it names. */
function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.1em] text-base-600">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[13px] tabular-nums text-base-200">
        {value}
        {hint ? (
          <span className="ml-2 font-sans text-[11px] text-base-600">{hint}</span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The requirement-by-requirement matrix.
 *
 * It is the longest thing on the page — nineteen requirements, each with the sentence
 * from the document under it — and it used to run down one half of a two-column grid,
 * which is how the report grew four screens with nothing beside them. Full width, capped,
 * and scrolling in place: the section is now a fixed landmark rather than the page.
 */
function PrdSection({ report }: { report: TestQualityReport }) {
  if (!report.prd) {
    return (
      <Section id="prd" className="px-6 py-5">
        <p className="max-w-[70ch] text-xs leading-relaxed text-base-500">
          No PRD was supplied for this run. Attach one on the launcher to get a
          requirement-by-requirement traceability matrix showing exactly which stated
          requirements have no test behind them.
        </p>
      </Section>
    );
  }

  const without = report.prd.filter((r) => !r.covered).length;

  return (
    <Section id="prd">
      <SectionHeader
        title="PRD traceability"
        subtitle="Every stated requirement, and whether a test that ran proves it. A scenario is not evidence."
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone="ok">{report.prd.length - without} with evidence</Badge>
            <Badge tone="warn">{without} without</Badge>
          </div>
        }
      />
      <ScrollArea maxHeight="36rem">
        <ul className="divide-y divide-base-850">
          {report.prd.map((r) => {
            const meta = PRD_META[r.status ?? (r.covered ? "proven" : "uncovered")];
            return (
              <li key={r.id} className="flex items-start gap-3 px-6 py-3">
                <span
                  title={meta.label}
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                    meta.tone === "ok" && "border-ok-500/40 bg-ok-500/12 text-ok-400",
                    meta.tone === "warn" && "border-warn-500/40 bg-warn-500/12 text-warn-400",
                    meta.tone === "violet" && "border-violet-500/40 bg-violet-500/12 text-violet-400",
                    meta.tone === "danger" && "border-danger-500/40 bg-danger-500/12 text-danger-400",
                  )}
                >
                  {meta.mark}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="max-w-[86ch] text-[13px] leading-snug text-base-200">
                    {r.text}
                  </p>
                  {/* Verbatim from the document. The cheapest possible defence
                      against a confident extraction of requirements the PRD
                      does not contain — a reader checks it in seconds. */}
                  {r.quote ? (
                    <p className="mt-1 max-w-[86ch] border-l border-base-800 pl-2 text-[11px] leading-relaxed text-base-500 italic">
                      “{r.quote}”
                    </p>
                  ) : null}
                  <p className="mt-1 font-mono text-[10px] text-base-600">
                    {r.id} · {meta.label}
                    {r.coveredBy.length ? ` → ${r.coveredBy.join(", ")}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
      {report.prdUntraced?.length ? (
        <p className="max-w-[86ch] border-t border-base-850 px-6 py-3 text-[11px] leading-relaxed text-base-500">
          <span className="text-base-300">
            {report.prdUntraced.length} scenario(s) trace to no stated requirement
          </span>{" "}
          — {report.prdUntraced.join(", ")}. Either the PRD does not ask for this
          behaviour, or it does and the document does not say so.
        </p>
      ) : null}
    </Section>
  );
}

/**
 * The files the run left behind, shown rather than named.
 *
 * A report that cites `results/artifacts/orders-view/test-failed-1.png` is citing a path
 * on a disk the reader does not have. The screenshot of the page at the moment the test
 * died is the single most persuasive artifact this pipeline produces, and it was being
 * rendered as a filename.
 */
function EvidenceSection({
  runId,
  artifacts,
}: {
  runId: string;
  artifacts: ArtifactEvent[];
}) {
  const href = (path: string) =>
    `/api/runs/${runId}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

  const shots = artifacts.filter((a) => a.kind === "screenshot");
  const rest = artifacts.filter((a) => a.kind !== "screenshot");
  if (!artifacts.length) return null;

  return (
    <Section id="evidence">
      <SectionHeader
        title="Evidence"
        subtitle="Every file the run wrote — screenshots at the moment of failure, traces, videos, patches"
        right={<Badge mono>{artifacts.length} files</Badge>}
      />

      <ScrollArea maxHeight="36rem">
        {shots.length ? (
          <ul className="grid gap-3 px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {shots.map((a) => (
              <li key={a.seq}>
                <a
                  href={href(a.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-lg border border-base-850 transition hover:border-base-700"
                >
                  {/* Deliberately a plain <img>: these are arbitrary run artifacts served
                      from an API route, not assets the optimiser knows the shape of. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={href(a.path)}
                    alt={a.title}
                    loading="lazy"
                    className="block aspect-video w-full bg-base-950 object-cover object-top"
                  />
                  <div className="border-t border-base-850 bg-base-900/40 px-2.5 py-1.5">
                    <p className="truncate text-[12px] text-base-300">{a.title}</p>
                    <p className="truncate font-mono text-[10px] text-base-600">{a.path}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {rest.length ? (
          <ul
            className={cn(
              "divide-y divide-base-850",
              shots.length > 0 && "border-t border-base-850",
            )}
          >
            {rest.map((a) => (
              <li key={a.seq}>
                <a
                  href={href(a.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 px-6 py-2 transition hover:bg-base-900/60"
                >
                  <Badge mono>{a.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-base-300">
                    {a.title}
                  </span>
                  <span className="truncate font-mono text-[10px] text-base-600">
                    {a.path}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </ScrollArea>
    </Section>
  );
}

/**
 * The arithmetic behind "scenarios covered" and "untested flow risk".
 *
 * Both of those numbers are ratios and neither is checkable without its denominator, so
 * the denominator is printed. `signal` is the part worth reading: it says whether a
 * surface was attributed to a test because the emitted code navigates there, or merely
 * because the plan said it would.
 */
function CoverageSection({ surfaces }: { surfaces?: SurfaceCoverage[] }) {
  if (!surfaces?.length) return null;
  const exercised = surfaces.filter((s) => s.status === "exercised").length;

  return (
    <Section flush id="coverage">
      <SectionHeader
        title="Coverage working"
        subtitle="Attribution is read off the emitted test source, not taken from the plan's word for it"
        right={
          <Badge tone={exercised === surfaces.length ? "ok" : "warn"}>
            {exercised}/{surfaces.length} surfaces exercised
          </Badge>
        }
      />
      <ScrollArea maxHeight="30rem" className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-base-950">
            <tr className="text-[11px] uppercase tracking-wider text-base-600 [&>th]:border-b [&>th]:border-base-850">
              <th className="px-6 py-2 font-medium">Surface</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Attributed by</th>
              <th className="px-6 py-2 font-medium">Basis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base-850">
            {surfaces.map((s) => (
              <tr key={s.surface} className="align-top transition-colors hover:bg-base-900/40">
                <td className="px-6 py-2 font-mono text-[12px] text-base-200">{s.surface}</td>
                <td className="px-3 py-2">
                  <Badge tone={SURFACE_TONE[s.status]}>{s.status}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-base-500">{s.signal}</td>
                <td className="px-6 py-2 text-[11px] leading-relaxed text-base-500">
                  {s.basis ?? "No scenario named it and no emitted test reaches it"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </Section>
  );
}
