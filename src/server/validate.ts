/**
 * Input validation for the run API.
 *
 * The launcher already normalises the URL, but the API is the real boundary — a run
 * spawns a browser against whatever it is handed, so nothing gets in unchecked.
 */

import { DEFAULT_RUN_OPTIONS, type RunInput, type RunOptions } from "@/lib/types";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

export function parseRunInput(body: unknown): Parsed<RunInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object" };
  const b = body as Record<string, unknown>;

  if (typeof b.url !== "string" || !b.url.trim()) {
    return { ok: false, error: "A target URL is required" };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(b.url.trim()) ? b.url.trim() : `https://${b.url.trim()}`);
  } catch {
    return { ok: false, error: "That is not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https targets are supported" };
  }

  const o = (b.options ?? {}) as Partial<RunOptions>;
  const options: RunOptions = {
    maxScenarios: clamp(o.maxScenarios, 1, 100, DEFAULT_RUN_OPTIONS.maxScenarios),
    maxReplans: clamp(o.maxReplans, 0, 5, DEFAULT_RUN_OPTIONS.maxReplans),
    maxHealAttemptsPerTest: clamp(o.maxHealAttemptsPerTest, 0, 5, DEFAULT_RUN_OPTIONS.maxHealAttemptsPerTest),
    parallelWorkers: clamp(o.parallelWorkers, 1, 16, DEFAULT_RUN_OPTIONS.parallelWorkers),
    headless: typeof o.headless === "boolean" ? o.headless : DEFAULT_RUN_OPTIONS.headless,
    budgetUsd: clamp(o.budgetUsd, 0.25, 100, DEFAULT_RUN_OPTIONS.budgetUsd),
  };

  const prd = b.prd as { filename?: unknown; text?: unknown } | undefined;
  const creds = b.credentials as { username?: unknown; password?: unknown } | undefined;

  return {
    ok: true,
    value: {
      url: url.toString(),
      intent: typeof b.intent === "string" && b.intent.trim() ? b.intent.trim().slice(0, 500) : undefined,
      prd:
        prd && typeof prd.filename === "string" && typeof prd.text === "string"
          ? { filename: prd.filename.slice(0, 200), text: prd.text.slice(0, 200_000) }
          : undefined,
      credentials:
        creds && typeof creds.username === "string" && creds.username
          ? { username: creds.username, password: typeof creds.password === "string" ? creds.password : "" }
          : undefined,
      options,
    },
  };
}
