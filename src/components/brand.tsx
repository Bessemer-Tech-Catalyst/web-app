import Link from "next/link";
import { cn } from "@/lib/format";

/** Odyssey: a compass rose — a long voyage, navigated rather than wandered. */
export function OdysseyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
    >
      <defs>
        <linearGradient id="ody-needle" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-ember-300)" />
          <stop offset="100%" stopColor="var(--color-ember-600)" />
        </linearGradient>
      </defs>
      {/* bezel */}
      <circle
        cx="16"
        cy="16"
        r="12.4"
        stroke="currentColor"
        strokeWidth="1.7"
        opacity="0.85"
      />
      {/* cardinal ticks */}
      <path
        d="M16 1.4v3.2M16 27.4v3.2M1.4 16h3.2M27.4 16h3.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* needle — north half burns */}
      <path d="M16 6.4 19.3 16 16 25.6 12.7 16Z" fill="url(#ody-needle)" />
      <path
        d="M16 6.4 19.3 16h-6.6L16 6.4Z"
        fill="var(--color-ember-300)"
        opacity="0.55"
      />
      <circle cx="16" cy="16" r="1.5" fill="var(--color-base-950)" />
    </svg>
  );
}

export function Wordmark({
  href = "/",
  compact,
}: {
  href?: string;
  /** Mark only — used by the collapsed sidebar rail. */
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-2"
      aria-label="The Odyssey — home"
    >
      <OdysseyMark className="size-5.5 shrink-0 text-base-500 transition-colors group-hover:text-base-200" />
      {compact ? null : (
        <span className="truncate text-[15px] leading-none font-semibold tracking-tight text-base-100">
          <span className="font-normal text-base-400">The </span>Odyssey
        </span>
      )}
    </Link>
  );
}
