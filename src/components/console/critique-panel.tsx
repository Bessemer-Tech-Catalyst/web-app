import { Badge, Section, SectionHeader, Empty, Meter } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import type { Critique, CritiqueDimension } from "@/lib/types";

const DIMENSION_LABEL: Record<CritiqueDimension, string> = {
  "flow-completeness": "Flow completeness",
  "negative-paths": "Negative paths",
  "error-states": "Error states",
  "edge-cases": "Edge cases",
  "state-variants": "State variants",
  destructive: "Destructive",
};

export function CritiquePanel({ critiques }: { critiques: Critique[] }) {
  const latest = critiques.at(-1);

  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title="Coverage critic"
        subtitle="The gate between planning and generation"
        right={
          latest ? (
            <Badge tone={latest.verdict === "pass" ? "ok" : "warn"}>
              {latest.verdict === "pass" ? "accepted" : "re-planning"}
            </Badge>
          ) : null
        }
      />
      {!latest ? (
        <Empty>The plan has not been graded yet</Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-end gap-3">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-4xl font-semibold tabular-nums",
                  latest.score >= 85
                    ? "text-ok-400"
                    : latest.score >= 70
                      ? "text-warn-500"
                      : "text-danger-400",
                )}
              >
                {latest.score}
              </span>
              <span className="text-sm text-base-600">/100</span>
            </div>
            {latest.previousScore !== undefined && (
              <span className="mb-1 flex items-center gap-1 font-mono text-xs text-ok-400">
                <span className="text-base-600">{latest.previousScore}</span>
                <span aria-hidden>→</span>
                <span>+{latest.score - latest.previousScore}</span>
              </span>
            )}
            <span className="mb-1 ml-auto font-mono text-[11px] text-base-600">
              pass {latest.attempt}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {(Object.keys(DIMENSION_LABEL) as CritiqueDimension[]).map((d) => {
              const v = latest.dimensions[d];
              return (
                <div key={d}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs text-base-400">{DIMENSION_LABEL[d]}</span>
                    <span className="font-mono text-[11px] tabular-nums text-base-500">
                      {v}
                    </span>
                  </div>
                  <Meter
                    value={v}
                    label={DIMENSION_LABEL[d]}
                    tone={v >= 80 ? "ok" : v >= 55 ? "warn" : "danger"}
                  />
                </div>
              );
            })}
          </div>

          <p className="mt-4 border-l-2 border-base-800 pl-3 text-[13px] leading-relaxed text-base-400">
            {latest.rationale}
          </p>

          {latest.gaps.length > 0 && (
            <>
              <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wider text-base-500">
                {latest.verdict === "pass"
                  ? "Accepted gaps — carried to the risk ledger"
                  : `${latest.gaps.length} gaps sent back to the planner`}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {latest.gaps.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-md bg-base-900 px-2.5 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <Badge
                        tone={
                          g.severity === "critical"
                            ? "danger"
                            : g.severity === "high"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {g.severity}
                      </Badge>
                      <span className="text-xs font-medium text-base-200">{g.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-base-500">
                      {g.rationale}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Section>
  );
}
