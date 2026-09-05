"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Section, SectionHeader, Empty } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import type { AgentName, OrchestratorEvent } from "@/lib/types";

type ActivityEvent = Extract<
  OrchestratorEvent,
  { type: "agent.tool" | "agent.thinking" }
>;

/**
 * Agent identity is a tick of colour on the rule at the left of the row, not the colour
 * of the row's brightest text.
 *
 * Eight saturated hues — blue, violet, amber, green, red, two embers — were competing
 * with each other and with the ember accent, on the name of the agent, which is the
 * *least* variable thing in a row. Meanwhile the tool being called was set in the dim
 * end of the ramp. The hierarchy was upside down: what changed line to line was quiet,
 * and what stayed the same shouted. So the name is now plain ink at a fixed width, the
 * tool name carries the weight, and the hue survives only as a 2px rule — enough to see
 * a lane change while scrolling, not enough to be the first thing you look at.
 */
const AGENT_RULE: Record<AgentName, string> = {
  orchestrator: "bg-ember-500",
  recon: "bg-info-500",
  planner: "bg-violet-500",
  critic: "bg-warn-500",
  generator: "bg-ok-500",
  runner: "bg-base-500",
  classifier: "bg-danger-500",
  healer: "bg-ember-300",
};

/**
 * Reasoning summaries arrive as markdown — `**Weighing the auth flows** I'm thinking
 * through…` — and were printed with the asterisks intact, which is the single clearest
 * tell that nobody looked at this panel. The bold runs are the model's own section
 * headings, so they are rendered as headings.
 */
function Thinking({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <span className="min-w-0 flex-1 italic text-base-400 [overflow-wrap:anywhere]">
      {parts.map((part, i) =>
        // Odd indices are the captured groups — what sat between the asterisks.
        i % 2 ? (
          <strong key={i} className="font-semibold text-base-300 not-italic">
            {part}{" "}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

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
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {activity.length === 0 ? (
          <Empty>Idle</Empty>
        ) : (
          <ul>
            {activity.map((a, i) => {
              const detail = a.type === "agent.tool" ? a.detail : undefined;
              const open = expanded.has(a.seq);
              // The rule is drawn once per run of rows from the same agent, so a lane
              // reads as one continuous stroke rather than a dashed ladder.
              const sameAsPrev = activity[i - 1]?.agent === a.agent;
              return (
                <li
                  key={a.seq}
                  className="animate-stream-in flex gap-3 px-4 hover:bg-base-900/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "w-0.5 shrink-0",
                      AGENT_RULE[a.agent],
                      // A hair of transparency keeps the rule from reading as a border.
                      "opacity-70",
                    )}
                  />
                  <div className="min-w-0 flex-1 py-1 font-mono text-meta">
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className={cn(
                          "w-[4.75rem] shrink-0 truncate",
                          sameAsPrev ? "text-transparent" : "text-base-500",
                        )}
                      >
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
                                  ? "text-base-500 hover:text-base-100"
                                  : "text-danger-400 hover:text-danger-300",
                              )}
                            >
                              {a.ok ? "›" : "✕"}
                            </button>
                          ) : (
                            <span
                              className={cn(
                                "shrink-0",
                                a.ok ? "text-base-500" : "text-danger-400",
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
                            {/* What varies row to row gets the weight. */}
                            <span
                              className={cn(
                                "font-medium",
                                a.ok ? "text-base-100" : "text-danger-400",
                              )}
                            >
                              {a.tool}
                            </span>{" "}
                            <span className="text-base-500">{a.summary}</span>
                          </span>
                        </>
                      ) : (
                        <Thinking text={a.text} />
                      )}
                    </div>
                    {detail && open ? (
                      <pre className="ml-[5.75rem] mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-base-800 bg-base-950 p-2.5 text-meta text-base-400">
                        {detail}
                      </pre>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
