import type { ComponentType } from "react";

/**
 * 24px stroke icons, drawn on a shared grid so the collapsed rail reads evenly.
 * Colour comes from `currentColor` — the sidebar owns active/hover state.
 */
type IconProps = { className?: string };

function Svg({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? "size-[18px] shrink-0"}
    >
      {children}
    </svg>
  );
}

export const IconOverview: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.6" />
  </Svg>
);

export const IconRun: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 4.5 19 12 6 19.5V4.5Z" />
  </Svg>
);

export const IconRuns: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3.5 7h9M3.5 12h13M3.5 17h7" />
    <circle cx="19" cy="17.5" r="2.5" />
  </Svg>
);

export const IconSchedule: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    <path d="M12 13v3l2 1.2" />
  </Svg>
);

export const IconTarget: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconDefect: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="7.5" y="7.5" width="9" height="11" rx="4.5" />
    <path d="M9.5 6.2a2.5 2.5 0 0 1 5 0M3.5 11h4M16.5 11h4M3.5 16.5h4M16.5 16.5h4M12 8v9" />
  </Svg>
);

export const IconCoverage: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3.5 20 7v5.5c0 4.4-3.2 7-8 8-4.8-1-8-3.6-8-8V7l8-3.5Z" />
    <path d="M9 12.2l2.2 2.3L15.4 10" />
  </Svg>
);

export const IconSettings: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1Z" />
  </Svg>
);

export const IconChevron: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const IconMenu: ComponentType<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
