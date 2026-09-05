"use client";

import { useEffect, useRef, useState } from "react";
import { Section, SectionHeader, Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import type { AgentName, OrchestratorEvent } from "@/lib/types";

type ActivityEvent = Extract<
  OrchestratorEvent,
  { type: "agent.tool" | "agent.thinking" }
>;

const AGENT_COLOR: Record<AgentName, string> = {
  orchestrator: "text-ember-400",
  recon: "text-info-500",
  planner: "text-violet-500",
  critic: "text-warn-500",
  generator: "text-ok-400",
  runner: "text-base-300",
  classifier: "text-danger-400",
  healer: "text-ember-300",
};

export function ActivityFeed({ activity }: { activity: ActivityEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the feed is following its tail. Recorded from the reader's own scrolling
   * rather than measured when new rows arrive: by the time an effect runs, the rows are
   * already in the DOM, so a batch taller than the threshold makes an at-the-bottom reader
   * measure as one who has scrolled away — and following then switches off for the rest of
   * the run. It starts true so a tab opened mid-run lands on the newest line.
   */
  const following = useRef(true);

  /** Rows the reader has opened, by event seq. */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const toggle = (seq: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });

  // `scrollIntoView` on an element inside a scroll container also scrolls every *ancestor*
  // container, which on a narrow viewport yanks the whole console; setting scrollTop moves
  // this panel and nothing else.
  // Keyed on the newest event's seq, not on `activity.length`: the reducer keeps only the
  // last 200 events, so past that point the length is a constant 200 and an effect
  // watching it never runs again — the feed froze exactly when a run got long enough to
  // need following. Seq is monotonic, so it changes on every event for the whole run.
  useEffect(() => {
    const box = scrollRef.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [activity.at(-1)?.seq]);

  return (
    <Section flush className="flex min-h-0 flex-col">
      <SectionHeader
        title="Agent activity"
        subtitle="Raw sub-agent tool calls and reasoning"
      />
      {/* Vertical only. A tool summary can carry a hundred characters of unbroken JSON —
          `browser_fill_form fields=[{"target":"f5e102",…` — and with a horizontal scrollbar
          those rows drag the whole feed sideways, leaving the panel showing empty gutter
          while a run is streaming into it. The rows below break anywhere instead. */}
      <div
        ref={scrollRef}
        // Scrolling up stops the feed following; scrolling back to within a row or two of
        // the bottom resumes it. Our own scroll below lands at the bottom, so it re-arms
        // this rather than fighting it.
        onScroll={(e) => {
          const box = e.currentTarget;
          following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
      >
        {activity.length === 0 ? (
          <Empty>Idle</Empty>
        ) : (
          <ul className="space-y-0.5">
            {activity.map((a) => {
              const detail = a.type === "agent.tool" ? a.detail : undefined;
              const open = expanded.has(a.seq);
              return (
                <li
                  key={a.seq}
                  className="animate-stream-in rounded px-1 py-1 font-mono text-[11px] leading-4"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className={cn("w-[4.5rem] shrink-0", AGENT_COLOR[a.agent])}>
                      {a.agent}
                    </span>
                    {a.type === "agent.tool" ? (
                      <>
                        {/* The marker used to be decoration that looked like a control:
                            a chevron beside a truncated line reads as "open me", and
                            clicking it did nothing. Where the call carries its full text
                            it is now the control it looked like; where it does not, it
                            stays a plain status mark rather than an empty promise. */}
                        {detail ? (
                          <button
                            onClick={() => toggle(a.seq)}
                            aria-expanded={open}
                            aria-label={open ? "Hide call detail" : "Show call detail"}
                            className={cn(
                              "shrink-0 transition",
                              open && "rotate-90",
                              a.ok
                                ? "text-base-500 hover:text-base-200"
                                : "text-danger-400 hover:text-danger-300",
                            )}
                          >
                            {a.ok ? "›" : "✕"}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "shrink-0",
                              a.ok ? "text-base-600" : "text-danger-400",
                            )}
                          >
                            {a.ok ? "·" : "✕"}
                          </span>
                        )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 [overflow-wrap:anywhere]",
                            detail && "cursor-pointer",
                          )}
                          onClick={detail ? () => toggle(a.seq) : undefined}
                        >
                          <span className="text-base-300">{a.tool}</span>{" "}
                          <span className="text-base-500">{a.summary}</span>
                        </span>
                      </>
                    ) : (
                      <span className="min-w-0 flex-1 italic text-base-500 [overflow-wrap:anywhere]">
                        {a.text}
                      </span>
                    )}
                  </div>
                  {detail && open ? (
                    <pre className="mt-1.5 ml-[5.5rem] max-h-64 overflow-auto whitespace-pre-wrap rounded border border-base-850 bg-base-950 p-2 text-[10px] leading-4 text-base-400">
                      {detail}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
