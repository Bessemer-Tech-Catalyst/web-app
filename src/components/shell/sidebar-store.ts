"use client";

/**
 * Sidebar collapse state lives outside React so it can be read from localStorage
 * without a setState-in-effect: `useSyncExternalStore` renders the server snapshot
 * during hydration, then swaps in the stored value on its own.
 */

const KEY = "odyssey:sidebar-collapsed";

let listeners: Array<() => void> = [];
let cached: boolean | null = null;

export function subscribe(cb: () => void): () => void {
  listeners = [...listeners, cb];
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function getSnapshot(): boolean {
  if (cached === null) {
    try {
      cached = localStorage.getItem(KEY) === "1";
    } catch {
      cached = false; // Storage disabled — expanded is a fine default.
    }
  }
  return cached;
}

/** Server render (and the hydration pass) always starts expanded. */
export function getServerSnapshot(): boolean {
  return false;
}

export function setCollapsed(next: boolean) {
  cached = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
  for (const l of listeners) l();
}
