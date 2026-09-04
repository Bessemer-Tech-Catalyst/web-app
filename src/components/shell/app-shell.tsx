"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand";
import { Badge, Dot } from "@/components/ui/primitives";
import { cn } from "@/lib/format";
import { IconChevron, IconMenu, IconRun } from "./nav-icons";
import { isActive, NAV, type NavItem } from "./nav";
import {
  getServerSnapshot,
  getSnapshot,
  setCollapsed,
  subscribe,
} from "./sidebar-store";

/**
 * The persistent chrome: a rail that collapses to icons and expands to labels,
 * plus a mobile drawer over the same nav. Every route renders inside it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [drawer, setDrawer] = useState(false);

  const toggle = useCallback(() => setCollapsed(!getSnapshot()), []);

  // ⌘/Ctrl-B mirrors what every editor with a sidebar already trained people to press.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setDrawer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ---------- desktop rail ---------- */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-base-850 bg-base-950/70 backdrop-blur transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[60px]" : "w-[228px]",
        )}
      >
        <SidebarBody collapsed={collapsed} pathname={pathname} onToggle={toggle} />
      </aside>

      {/* ---------- mobile drawer ---------- */}
      {drawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-base-950/70 backdrop-blur-sm"
          />
          <aside className="animate-stream-in absolute inset-y-0 left-0 flex w-[228px] flex-col border-r border-base-850 bg-base-950">
            <SidebarBody
              collapsed={false}
              pathname={pathname}
              onNavigate={() => setDrawer(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only bar — the rail is the desktop equivalent. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-base-850 px-3 py-2.5 md:hidden">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-base-400 hover:bg-base-850 hover:text-base-100"
          >
            <IconMenu />
          </button>
          <Wordmark />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function SidebarBody({
  collapsed,
  pathname,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  pathname: string;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "flex h-[57px] shrink-0 items-center border-b border-base-850",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        <Wordmark
          subtitle={collapsed ? undefined : "Test orchestration"}
          compact={collapsed}
        />
        {onToggle && !collapsed ? (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar (⌘B)"
            className="rounded-md p-1 text-base-600 transition hover:bg-base-850 hover:text-base-200"
          >
            <IconChevron className="size-4" />
          </button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((section, i) => (
          <div key={section.title} className="mb-4 last:mb-0">
            {collapsed ? (
              i > 0 ? <div className="mx-2 mb-2 h-px bg-base-850" /> : null
            ) : (
              <div className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-base-600">
                {section.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={isActive(pathname, item)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-base-850 p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <Link
              href="/new"
              title="New run"
              className="flex size-9 items-center justify-center rounded-lg bg-ember-500 text-base-950 transition hover:bg-ember-400"
            >
              <IconRun className="size-4" />
            </Link>
            {onToggle ? (
              <button
                onClick={onToggle}
                aria-label="Expand sidebar"
                title="Expand sidebar (⌘B)"
                className="rounded-md p-1.5 text-base-600 transition hover:bg-base-850 hover:text-base-200"
              >
                <IconChevron className="size-4 rotate-180" />
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <Link
              href="/new"
              onClick={onNavigate}
              className="flex items-center justify-center gap-2 rounded-lg bg-ember-500 px-3 py-2 text-[13px] font-semibold text-base-950 transition hover:bg-ember-400"
            >
              <IconRun className="size-3.5" />
              New run
            </Link>
            <div className="mt-2 flex items-center gap-2 px-1.5 py-1 text-[11px] text-base-600">
              <Dot tone="ok" />
              <span>Orchestrator idle</span>
              <span className="ml-auto font-mono">v0.4</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-lg text-[13px] transition",
        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2",
        active
          ? "bg-ember-500/12 text-ember-300"
          : "text-base-400 hover:bg-base-850/70 hover:text-base-100",
      )}
    >
      {active ? (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-ember-500" />
      ) : null}
      <Icon className={cn("size-[18px] shrink-0", active && "text-ember-400")} />
      {collapsed ? null : (
        <>
          <span className="truncate">{item.label}</span>
          {item.badge ? (
            <Badge tone={active ? "ember" : "neutral"} className="ml-auto" mono>
              {item.badge}
            </Badge>
          ) : null}
        </>
      )}
    </Link>
  );
}
