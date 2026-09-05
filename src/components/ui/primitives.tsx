import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import type { Tone } from "@/lib/types";

export type { Tone };

/**
 * Surfaces here are sections, not cards: nothing floats, nothing is rounded,
 * and regions are told apart by a hairline rule rather than by a border plus a
 * gap plus a tint. Radius is reserved for things you can click or type into.
 *
 * The horizontal rhythm is one number — SECTION_X — so a section header, a list
 * row and a table cell all start on the same vertical line down the page.
 */

// --- Section ----------------------------------------------------------------

/** The page's horizontal gutter. Every row and header uses it. */
export const SECTION_X = "px-6";

export function Section({
  children,
  className,
  as: Tag = "section",
  flush,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  /** Drop the closing rule — for the last section on a page. */
  flush?: boolean;
}) {
  return (
    <Tag className={cn(!flush && "border-b border-base-850", className)}>
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
  className,
  rule = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** A rule under the header, for sections whose body is a list or a table. */
  rule?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-4",
        SECTION_X,
        rule && "border-b border-base-850",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-base-100">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-xs leading-relaxed text-base-500">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0 text-xs">{right}</div> : null}
    </div>
  );
}

/**
 * Columns told apart by a vertical rule instead of a gap — the row of figures
 * across the top of a page, or two lists sitting side by side. Stacks into
 * horizontal rules below the breakpoint.
 */
export function SplitGrid({
  children,
  className,
  cols = 2,
}: {
  children: ReactNode;
  className?: string;
  cols?: 2 | 3 | 4;
}) {
  const at: Record<2 | 3 | 4, string> = {
    2: "sm:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  };
  return (
    <div
      className={cn(
        "grid divide-y divide-base-850",
        at[cols],
        cols === 3
          ? "lg:divide-x lg:divide-y-0"
          : "sm:divide-x sm:divide-y-0 lg:divide-x",
        cols === 4 && "sm:max-lg:divide-y",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One line in a list section. Keeps every list on the same gutter and height. */
export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("py-3.5", SECTION_X, className)}>{children}</div>;
}

// --- Badge ------------------------------------------------------------------

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-base-700 bg-base-800/70 text-base-300",
  ember: "border-ember-600/40 bg-ember-600/12 text-ember-300",
  ok: "border-ok-500/35 bg-ok-500/12 text-ok-400",
  warn: "border-warn-500/35 bg-warn-500/12 text-warn-500",
  danger: "border-danger-500/40 bg-danger-500/12 text-danger-400",
  info: "border-info-500/35 bg-info-500/12 text-info-500",
  violet: "border-violet-500/35 bg-violet-500/12 text-violet-500",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  mono,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        mono && "font-mono",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// --- Dot --------------------------------------------------------------------

export function Dot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  const bg: Record<Tone, string> = {
    neutral: "bg-base-600",
    ember: "bg-ember-500",
    ok: "bg-ok-500",
    warn: "bg-warn-500",
    danger: "bg-danger-500",
    info: "bg-info-500",
    violet: "bg-violet-500",
  };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        bg[tone],
        pulse && "animate-pulse-ring",
      )}
    />
  );
}

// --- Meter ------------------------------------------------------------------

export function Meter({
  value,
  tone = "ember",
  className,
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const fill: Record<Tone, string> = {
    neutral: "bg-base-500",
    ember: "bg-ember-500",
    ok: "bg-ok-500",
    warn: "bg-warn-500",
    danger: "bg-danger-500",
    info: "bg-info-500",
    violet: "bg-violet-500",
  };
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-base-800", className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fill[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// --- Empty ------------------------------------------------------------------

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-28 items-center justify-center px-6 py-10 text-center text-xs text-base-600">
      {children}
    </div>
  );
}

// --- Stat -------------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const color: Record<Tone, string> = {
    neutral: "text-base-100",
    ember: "text-ember-400",
    ok: "text-ok-400",
    warn: "text-warn-500",
    danger: "text-danger-400",
    info: "text-info-500",
    violet: "text-violet-500",
  };
  return (
    <div className={cn("py-5", SECTION_X)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-base-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-[28px] leading-none font-semibold tabular-nums",
          color[tone],
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 text-xs text-base-600">{hint}</div> : null}
    </div>
  );
}

// --- Code -------------------------------------------------------------------

export function Code({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: "add" | "remove";
}) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md px-3 py-2.5 font-mono text-[11px] leading-relaxed",
        tone === "add" && "bg-ok-500/10 text-ok-400",
        tone === "remove" && "bg-danger-500/10 text-danger-400",
        !tone && "bg-base-900 text-base-300",
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}

// --- SampleNotice -----------------------------------------------------------

/**
 * Says, on the page itself, that what is below it is seeded rather than measured.
 *
 * Five surfaces in this console describe a *fleet* — many targets, many runs, a
 * schedule, defects across time — and this build drives one run at a time. Their data is
 * seeded, and unlabelled seeded data on a demo about never faking a number is the one
 * contradiction the product cannot afford. So it is labelled, everywhere it appears,
 * rather than quietly presented or hidden from the navigation.
 */
export function SampleNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-4 py-3">
      <Badge tone="violet">sample data</Badge>
      <p className="text-[13px] leading-relaxed text-base-400">
        {children ?? (
          <>
            This page shows the multi-run product around a single run, with seeded data.
            Nothing here was measured. Everything under{" "}
            <span className="text-base-200">Past runs</span> and inside any run you open is
            real, and is written to disk by the run that produced it.
          </>
        )}
      </p>
    </div>
  );
}
