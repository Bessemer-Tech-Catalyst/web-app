import type { ComponentType } from "react";
import {
  IconCoverage,
  IconDefect,
  IconOverview,
  IconRun,
  IconRuns,
  IconSchedule,
  IconSettings,
  IconTarget,
} from "./nav-icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Shown as a chip when the sidebar is expanded. */
  badge?: string;
  /** Nested routes that should still light this item up. */
  matchPrefix?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Pipeline",
    items: [
      { href: "/", label: "Overview", icon: IconOverview },
      { href: "/new", label: "New run", icon: IconRun },
      { href: "/runs", label: "Past runs", icon: IconRuns, matchPrefix: true },
      { href: "/schedule", label: "Schedule", icon: IconSchedule, matchPrefix: true },
    ],
  },
  {
    title: "Quality",
    items: [
      { href: "/coverage", label: "Coverage", icon: IconCoverage },
      { href: "/defects", label: "Defects", icon: IconDefect, badge: "4" },
    ],
  },
  {
    title: "Configuration",
    items: [
      { href: "/targets", label: "Targets", icon: IconTarget, matchPrefix: true },
      { href: "/settings", label: "Settings", icon: IconSettings },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
