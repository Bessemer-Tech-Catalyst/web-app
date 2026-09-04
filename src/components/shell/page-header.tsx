import type { ReactNode } from "react";

/**
 * The one header every non-console route wears, so pages line up vertically.
 * It shares the page gutter with every section below it, and its own rule is
 * the first of the hairlines that divide the page.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-base-850 px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight text-base-100">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-base-500">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Page content runs edge to edge — no padding, no gaps. Sections carry their own
 * gutter and close themselves with a rule, so regions meet without a seam.
 */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
