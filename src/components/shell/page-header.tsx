import type { ReactNode } from "react";

/** The one header every non-console route wears, so pages line up vertically. */
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
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-base-850 px-6 py-5">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-base-100">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-base-500">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-6 py-6 ${className ?? ""}`}>{children}</div>;
}
