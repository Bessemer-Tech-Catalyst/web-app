"use client";

import { useEffect, useRef } from "react";
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
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the tail, but only while the reader is already at it. `scrollIntoView` on an
  // element inside a scroll container also scrolls every *ancestor* container, which on a
  // narrow viewport yanks the whole console; setting scrollTop moves this panel and
  // nothing else. A reader who has scrolled up to read something is left where they are.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (atBottom) box.scrollTop = box.scrollHeight;
  }, [activity.length]);

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
        className="max-h-[55vh] min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
      >
        {activity.length === 0 ? (
          <Empty>Idle</Empty>
        ) : (
          <ul className="space-y-0.5">
            {activity.map((a) => (
              <li
                key={a.seq}
                className="animate-stream-in flex min-w-0 items-start gap-2 rounded px-1 py-1 font-mono text-[11px] leading-4"
              >
                <span className={cn("w-[4.5rem] shrink-0", AGENT_COLOR[a.agent])}>
                  {a.agent}
                </span>
                {a.type === "agent.tool" ? (
                  <>
                    <span
                      className={cn(
                        "shrink-0",
                        a.ok ? "text-base-600" : "text-danger-400",
                      )}
                    >
                      {a.ok ? "›" : "✕"}
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="text-base-300">{a.tool}</span>{" "}
                      <span className="text-base-500">{a.summary}</span>
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 italic text-base-500 [overflow-wrap:anywhere]">
                    {a.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
    </Section>
  );
}
