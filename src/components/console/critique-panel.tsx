import { Badge, Section, SectionHeader, Empty, Meter } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import type { Critique, CritiqueDimension, Tone } from "@/lib/types";

const DIMENSION_LABEL: Record<CritiqueDimension, string> = {
  "flow-completeness": "Flow completeness",
  "negative-paths": "Negative paths",
  "error-states": "Error states",
  "edge-cases": "Edge cases",
  "state-variants": "State variants",
  destructive: "Destructive",
};

/** One grade, one tone. Shared by the strip, the score and the breakdown. */
export function scoreTone(score: number): Tone {
  return score >= 85 ? "ok" : score >= 70 ? "warn" : "danger";
}

const SCORE_INK: Record<"ok" | "warn" | "danger", string> = {
  ok: "text-ok-400",
  warn: "text-warn-500",
  danger: "text-danger-400",
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
                  "text-figure font-semibold tabular-nums",
                  SCORE_INK[scoreTone(latest.score) as "ok" | "warn" | "danger"],
                )}
              >
                {latest.score}
              </span>
              <span className="text-body font-medium text-base-500">/100</span>
            </div>
            {latest.previousScore !== undefined && (
              <span className="mb-1 flex items-center gap-1 font-mono text-detail font-medium text-ok-400">
                <span className="text-base-500">{latest.previousScore}</span>
                <span aria-hidden>→</span>
                <span>+{latest.score - latest.previousScore}</span>
              </span>
            )}
            <span className="mb-1 ml-auto font-mono text-meta text-base-500">
              pass {latest.attempt}
            </span>
          </div>

          <div className="mt-5 space-y-2.5">
            {(Object.keys(DIMENSION_LABEL) as CritiqueDimension[]).map((d) => {
              const v = latest.dimensions[d];
              return (
                <div key={d}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-detail text-base-300">{DIMENSION_LABEL[d]}</span>
                    <span className="font-mono text-meta font-medium tabular-nums text-base-400">
                      {v}
                    </span>
                  </div>
                  <Meter
                    value={v}
                    label={DIMENSION_LABEL[d]}
                    // Colour marks the exceptions. Six bars in green, amber and red made
                    // a strong dimension shout exactly as loudly as a weak one, so the
                    // panel read as a warning light and said nothing. A dimension that
                    // cleared the bar is drawn in plain ink; the ones that did not are
                    // the only colour in the stack, and they are what the eye finds.
                    tone={v >= 80 ? "neutral" : v >= 55 ? "warn" : "danger"}
                  />
                </div>
              );
            })}
          </div>

          <p className="mt-5 border-l-2 border-base-700 pl-3 text-body text-base-300">
            {latest.rationale}
          </p>

          {latest.gaps.length > 0 && (
            <>
              <h3 className="mt-5 text-meta font-semibold uppercase tracking-[0.08em] text-base-400">
                {latest.verdict === "pass"
                  ? "Accepted gaps — carried to the risk ledger"
                  : `${latest.gaps.length} gaps sent back to the planner`}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {latest.gaps.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-md border border-base-850 bg-base-900 px-3 py-2.5"
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
                      <span className="text-detail font-semibold text-base-100">{g.title}</span>
                    </div>
                    <p className="mt-1.5 text-detail leading-relaxed text-base-500">
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
