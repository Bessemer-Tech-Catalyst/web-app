import Link from "next/link";
import { cn } from "@/lib/format";

/** The crucible: a vessel with molten content and rising heat. */
export function CrucibleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-7", className)}
    >
      <defs>
        <linearGradient id="cru-melt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ember-300)" />
          <stop offset="100%" stopColor="var(--color-ember-600)" />
        </linearGradient>
      </defs>
      {/* rising heat */}
      <path
        d="M12 7.5c0-2 1.6-2.6 1.6-4.5M16 6.5c0-2.4 1.8-3 1.8-5M20 7.5c0-2 1.6-2.6 1.6-4.5"
        stroke="var(--color-ember-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* vessel */}
      <path
        d="M5.5 12h21l-2.4 12.2a4 4 0 0 1-3.92 3.3h-8.36a4 4 0 0 1-3.92-3.3L5.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* melt line */}
      <path
        d="M7.4 16.4h17.2l-1.6 7.9a2.6 2.6 0 0 1-2.55 2.1h-8.9a2.6 2.6 0 0 1-2.55-2.1L7.4 16.4Z"
        fill="url(#cru-melt)"
        opacity="0.9"
      />
    </svg>
  );
}

export function Wordmark({
  href = "/",
  subtitle,
}: {
  href?: string;
  subtitle?: string;
}) {
  return (
    <Link href={href} className="group flex items-center gap-2.5">
      <CrucibleMark className="size-7 text-base-300 transition-colors group-hover:text-base-100" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-base-100">
          Crucible
        </span>
        {subtitle ? (
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-base-500">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
