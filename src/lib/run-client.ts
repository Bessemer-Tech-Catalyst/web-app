"use client";

/** Browser-side calls into the run API. */

import type { RunInput } from "./types";

export async function startRun(input: RunInput): Promise<string> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "Could not start the run");
  return body.id;
}

export async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
}
