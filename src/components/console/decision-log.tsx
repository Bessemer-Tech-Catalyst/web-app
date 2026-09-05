"use client";

import { useEffect, useRef } from "react";
import { Badge, Section, SectionHeader, Empty } from "@/components/ui/primitives";
import { cn, formatClock } from "@/lib/format";
import { STAGE_META, type Evidence, type OrchestratorEvent } from "@/lib/types";

type DecisionEvent = Extract<OrchestratorEvent, { type: "decision" }>;

const EVIDENCE_ICON: Record<Evidence["kind"], string> = {
  "snapshot-diff": "⇄",
  "console-error": "⚠",
  network: "↯",
  "http-status": "◈",
  "selector-provenance": "⌖",
  "cross-test": "⋈",
  screenshot: "▢",
  trace: "≡",
  "assertion-diff": "≠",
  prd: "§",
  heuristic: "∴",
};

/**
 * The hero panel. Every judgment the orchestrator makes, in plain English, with the
 * evidence it used. This is what separates an orchestrator from a pipeline.
 */
export function DecisionLog({ decisions }: { decisions: DecisionEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = decisions.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count]);

  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            Decision log
            <span className="rounded bg-ember-600/15 px-1.5 py-0.5 font-mono text-[10px] text-ember-400">
              {count}
            </span>
          </span>
        }
        subtitle="Every autonomous judgment, its reasoning, and the evidence behind it"
      />
      <div className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto">
        {count === 0 ? (
          // A log fills from the top, so its waiting state sits where the first entry
          // will — not floating in the middle of the panel it is about to fill.
          <Empty inline>
            Waiting on the first decision — they appear here as the orchestrator makes
            them, each with the evidence behind it
          </Empty>
        ) : (
          <ol className="divide-y divide-base-850">
            {decisions.map((d) => (
              <li
                key={d.seq}
                className="animate-stream-in px-6 py-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="ember" mono>
                    {STAGE_META[d.stage].label}
                  </Badge>
                  <Confidence value={d.confidence} />
                  <span className="ml-auto font-mono text-[10px] text-base-600">
                    {formatClock(d.ts)}
                  </span>
                </div>

                <p className="mt-2 text-sm font-medium leading-snug text-base-100">
                  {d.action}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-base-400">
                  {d.rationale}
                </p>

                {d.evidence.length > 0 && (
                  <ul className="mt-2.5 space-y-1">
                    {d.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-md bg-base-900 px-2.5 py-1.5"
                      >
                        <span
                          aria-hidden
                          className="mt-px font-mono text-[11px] leading-4 text-base-600"
                        >
                          {EVIDENCE_ICON[e.kind]}
                        </span>
                        <div className="min-w-0">
                          <span className="block font-mono text-[11px] leading-4 text-base-400">
                            {e.summary}
                          </span>
                          {e.detail ? (
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-base-600">
                              {e.detail}
                            </pre>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>
    </Section>
  );
}

/**
 * Rendered only where a confidence was actually computed. Most decisions do not carry
 * one, and an absent badge is the honest rendering of that — a judge asking "what does
 * 96% mean?" about a literal somebody typed is a hole; the same question about a number
 * derived from the classifier's per-failure confidences has an answer.
 */
function Confidence({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.9 ? "text-ok-400" : value >= 0.75 ? "text-warn-500" : "text-danger-400";
  return (
    <span className="flex items-center gap-1.5" title={`Confidence ${pct}%`}>
      <span className="flex gap-px" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-0.5 rounded-full",
              i < Math.round(value * 5) ? "bg-current" : "bg-base-800",
              tone,
            )}
          />
        ))}
      </span>
      <span className={cn("font-mono text-[10px] tabular-nums", tone)}>{pct}%</span>
    </span>
  );
}
