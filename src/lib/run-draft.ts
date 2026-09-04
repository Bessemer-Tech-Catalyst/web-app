"use client";

/**
 * Phase 1 hand-off between the launcher and the run console.
 *
 * The launcher stashes the RunInput in sessionStorage under the new run id; the console
 * reads it back and plays the scripted run. Phase 2 replaces this with a POST to
 * /api/runs that returns a real id, and the console reads state from the server.
 */

import { type RunInput } from "./types";

const KEY = (id: string) => `odyssey:run:${id}`;

export function newRunId(): string {
  return `run_${Math.random().toString(16).slice(2, 8)}`;
}

export function saveDraft(id: string, input: RunInput) {
  try {
    sessionStorage.setItem(KEY(id), JSON.stringify(input));
  } catch {
    // Private mode / storage disabled — the console falls back to a default input.
  }
}

export function loadDraft(id: string): RunInput | null {
  try {
    const raw = sessionStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as RunInput) : null;
  } catch {
    return null;
  }
}
