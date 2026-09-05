"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

/**
 * A region that is allowed to be long, but not allowed to be endless.
 *
 * Some sections of a report are genuinely large — nineteen requirements, twenty-six
 * artifacts — and letting them set the page height turns the rest of the document into
 * scenery you scroll past for four screens. Here they get a ceiling and their own
 * scrollbar, and the edges say so: a fade appears at the top or the bottom only when
 * there is actually something cut off in that direction, so an empty fade never implies
 * content that is not there.
 */
export function ScrollArea({
  children,
  className,
  maxHeight = "30rem",
}: {
  children: React.ReactNode;
  className?: string;
  /** Any CSS length. The region is only capped once its content exceeds this. */
  maxHeight?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const slack = el.scrollHeight - el.clientHeight;
    setEdge({
      top: el.scrollTop > 4,
      bottom: slack > 4 && el.scrollTop < slack - 4,
    });
  }, []);

  // Content streams in during a live run, so the overflow state is re-derived on
  // resize as well as on scroll rather than measured once on mount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        style={{ maxHeight }}
        className={cn("overflow-y-auto overscroll-contain", className)}
      >
        {children}
      </div>
      <Fade side="top" show={edge.top} />
      <Fade side="bottom" show={edge.bottom} />
    </div>
  );
}

function Fade({ side, show }: { side: "top" | "bottom"; show: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 h-12 transition-opacity duration-200",
        side === "top"
          ? "top-0 bg-gradient-to-b from-base-950 to-transparent"
          : "bottom-0 bg-gradient-to-t from-base-950 to-transparent",
        show ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
