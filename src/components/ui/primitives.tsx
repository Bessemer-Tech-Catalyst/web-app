import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import type { Tone } from "@/lib/types";

export type { Tone };

// --- Card -------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag
      className={cn(
        "rounded-xl border border-base-800 bg-base-900/60 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-base-800 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-base-100">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs leading-relaxed text-base-500">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
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
    <div className="flex min-h-24 items-center justify-center px-4 py-8 text-center text-xs text-base-600">
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
    <div className="px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-base-500">
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", color[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-base-500">{hint}</div> : null}
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
        "overflow-x-auto rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed",
        tone === "add" && "border-ok-500/25 bg-ok-500/8 text-ok-400",
        tone === "remove" && "border-danger-500/25 bg-danger-500/8 text-danger-400",
        !tone && "border-base-800 bg-base-950/70 text-base-300",
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
