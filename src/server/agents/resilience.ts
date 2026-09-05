/**
 * What a run does when the world misbehaves.
 *
 * Until this module existed the pipeline had no retries and no clocks. Every stage in
 * `orchestrator/run.ts` rethrows, so one 429 from the model provider, one `socket hang
 * up` from a CDN, one Chromium that took four seconds too long to boot, ended the entire
 * run — after the money for every stage before it had already been spent. On a bundled
 * demo target that almost never happened. On a URL handed over at judging time, against
 * a production site behind Cloudflare, it is the single likeliest way to lose a demo.
 *
 * Three separate ideas live here, deliberately kept apart:
 *
 * 1. **Classification.** Whether a failure is worth trying again. A rate limit is; a
 *    schema that does not validate is not, and retrying it burns the budget twice for
 *    the same answer. Getting this wrong in the permissive direction is expensive, so
 *    the transient list is an allowlist of recognised shapes and everything else is
 *    treated as permanent.
 * 2. **Retry.** Exponential backoff with full jitter, bounded by attempts *and* by a
 *    wall clock, honouring the run's abort signal and the provider's own `Retry-After`
 *    when it sends one.
 * 3. **Deadlines.** A ceiling in seconds on a stage, because `maxTurns` bounds how many
 *    times an agent may think and bounds nothing at all about how long one tool call may
 *    hang. A hung stage is indistinguishable from a crashed one to somebody watching a
 *    demo, and it cannot be recovered from without a clock.
 *
 * Nothing here knows about agents, models or browsers. It is pure control flow, which is
 * why `resilience.test.mts` can pin all of it with no key, no network and no Chromium.
 */

/** Why an attempt failed, as far as the retry policy is concerned. */
export type FailureClass =
  /** Worth trying again unchanged: rate limits, 5xx, dropped sockets, cold browsers. */
  | "transient"
  /** Trying again produces the same answer: bad schema, bad key, refusal, 4xx. */
  | "permanent"
  /** The caller asked us to stop. Never retried, never swallowed. */
  | "aborted";

/**
 * Error shapes that are worth another attempt.
 *
 * Matched against the message *and* against the numeric status or code when the error
 * carries one, because the Agents SDK, the MCP stdio transport and `undici` each report
 * the same underlying network fault in a different vocabulary.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  // Provider back-pressure and provider faults.
  /\brate[_ -]?limit/i,
  /\btoo many requests\b/i,
  /\boverloaded\b/i,
  /\bserver[_ ]?error\b/i,
  /\bservice unavailable\b/i,
  /\bbad gateway\b/i,
  /\bgateway timeout\b/i,
  /\binternal server error\b/i,
  /\btemporarily unavailable\b/i,
  // Transport. `socket hang up` and `ECONNRESET` are what a CDN in front of a target
  // sends when it decides it has seen enough of us for the moment.
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bEPIPE\b/,
  /\bEAI_AGAIN\b/,
  /\bENOTFOUND\b/,
  /\bsocket hang up\b/i,
  /\bnetwork (error|timeout)\b/i,
  /\bfetch failed\b/i,
  /\bconnection (closed|reset|error|refused)\b/i,
  /\bpremature close\b/i,
  // The MCP stdio transport and the browser it supervises. A Chromium that has not
  // finished starting, or a server whose pipe closed during handshake, is the classic
  // first-attempt-only failure: the second attempt gets a warm profile and works.
  /\bMCP server\b.*\b(closed|failed|not (connected|available))\b/i,
  /\btransport (closed|error)\b/i,
  /\bbrowser (is )?(closed|disconnected|has been closed)\b/i,
  /\btarget (page|context|browser) has been closed\b/i,
  /\bTimeout \d+ms exceeded\b/i,
  /\bdeadline exceeded\b/i,
  // A status code leading the message, which is how the OpenAI SDK formats an HTTP
  // failure it did not otherwise name ("429 You exceeded your current quota…").
  // Anchored to the start on purpose: a bare `429` anywhere in a sentence is as likely
  // to be a count as a status, and matching it would retry things that will never work.
  /^\s*(408|409|425|429|5\d{2})\b/,
];

/** HTTP statuses worth another attempt. 408 and 409 included; 4xx otherwise is not. */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Failures that look transient by their words and are not.
 *
 * `maxTurns` is the important one. The SDK reports a wedged agentic loop as an error
 * whose message mentions a limit being exceeded, which two of the patterns above would
 * happily match — and re-running a fifty-turn agent that just wedged costs the most
 * expensive stage in the run twice to arrive at the same wedge.
 */
const NEVER_TRANSIENT: RegExp[] = [
  /\bmax(imum)?[_ ]?turns\b/i,
  /\boutput schema\b/i,
  /\bdid not match\b/i,
  /\binvalid[_ ]?api[_ ]?key\b/i,
  /\bunauthorized\b/i,
  /\bauthentication\b/i,
  /\bpermission denied\b/i,
  /\binsufficient[_ ]?quota\b/i,
  /\bbilling\b/i,
  /\bmodel[_ ]?not[_ ]?found\b/i,
  /\bcontext[_ ]?length\b/i,
];

/** Pulls an HTTP status off whichever field the thrower happened to use. */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const v = e[key];
    if (typeof v === "number" && v >= 100 && v < 600) return v;
    if (typeof v === "string" && /^\d{3}$/.test(v)) return Number(v);
  }
  const res = e.response as Record<string, unknown> | undefined;
  if (res && typeof res.status === "number") return res.status;
  return undefined;
}

/** The whole error as searchable text, including a nested `cause`. */
export function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code = (err as { code?: unknown }).code;
    return [err.name, err.message, typeof code === "string" ? code : "", cause ? errorText(cause) : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Whether `err` is worth another attempt.
 *
 * An abort always wins: a run someone cancelled must not be kept alive by a retry loop,
 * and neither must one that has passed its deadline.
 */
export function classify(err: unknown, signal?: AbortSignal): FailureClass {
  if (signal?.aborted) return "aborted";
  if (err instanceof Error && (err.name === "AbortError" || err.name === "DeadlineError")) {
    return "aborted";
  }

  const text = errorText(err);
  if (NEVER_TRANSIENT.some((re) => re.test(text))) return "permanent";

  const status = statusOf(err);
  if (status !== undefined) return TRANSIENT_STATUS.has(status) ? "transient" : "permanent";

  return TRANSIENT_PATTERNS.some((re) => re.test(text)) ? "transient" : "permanent";
}

/**
 * `Retry-After`, when the provider bothered to send one, in milliseconds.
 *
 * Honouring it matters more than the backoff curve does: a provider that says "wait
 * eleven seconds" and is retried after two answers 429 again, and the run has then spent
 * two attempts of its allowance learning something it was told.
 */
function retryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const headers = ((err as Record<string, unknown>).headers ??
    ((err as Record<string, unknown>).response as Record<string, unknown> | undefined)?.headers) as
    | Record<string, unknown>
    | { get?: (k: string) => string | null }
    | undefined;
  if (!headers) return undefined;

  const raw =
    typeof (headers as { get?: (k: string) => string | null }).get === "function"
      ? (headers as { get: (k: string) => string | null }).get("retry-after")
      : ((headers as Record<string, unknown>)["retry-after"] ??
        (headers as Record<string, unknown>)["Retry-After"]);

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  return undefined;
}

export interface RetryPolicy {
  /** Total attempts including the first. 1 disables retrying without changing callers. */
  attempts: number;
  /** First backoff, doubled each attempt. */
  baseDelayMs: number;
  /** Ceiling on a single backoff, before jitter. */
  maxDelayMs: number;
  /**
   * Wall-clock ceiling on the whole retry sequence. Attempts stop once exceeding it is
   * the likely outcome, so a stage cannot spend the run's clock waiting to be let in.
   */
  totalMs?: number;
  signal?: AbortSignal;
  /** Called before each wait, so the caller can narrate the retry rather than hide it. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const DEFAULT_RETRY: Omit<RetryPolicy, "signal" | "onRetry"> = {
  attempts: 3,
  baseDelayMs: 1_500,
  maxDelayMs: 20_000,
  totalMs: 90_000,
};

/**
 * Full jitter, per AWS's published backoff guidance: a uniform draw from `[0, backoff]`
 * rather than `backoff ± noise`. With several agents behind one provider key, equal
 * waits reconverge into the same burst that caused the rate limit; a uniform draw is
 * what actually spreads them.
 */
export function backoffMs(attempt: number, p: Pick<RetryPolicy, "baseDelayMs" | "maxDelayMs">, rand = Math.random): number {
  const ceiling = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(rand() * ceiling);
}

/** A promise that settles after `ms`, or rejects the moment `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `body`, retrying only what is worth retrying.
 *
 * `body` receives the attempt number so a caller can weaken what it asks for on a second
 * try — the Generator does exactly this, dropping to a cheaper tier rather than failing.
 */
export async function withRetry<T>(
  body: (attempt: number) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const p: RetryPolicy = { ...DEFAULT_RETRY, ...policy };
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= p.attempts; attempt++) {
    try {
      return await body(attempt);
    } catch (err) {
      lastError = err;
      const kind = classify(err, p.signal);
      if (kind !== "transient" || attempt === p.attempts) throw err;

      const delay = retryAfterMs(err) ?? backoffMs(attempt, p);
      // Do not start a wait we already know outlives the allowance — failing now with
      // the real error beats failing in twenty seconds with the same one.
      if (p.totalMs !== undefined && Date.now() - startedAt + delay >= p.totalMs) throw err;

      p.onRetry?.({ attempt, delayMs: delay, error: err });
      await sleep(delay, p.signal);
    }
  }

  throw lastError;
}

/** Thrown when a stage runs past its ceiling. Distinct so callers can degrade on it. */
export class DeadlineError extends Error {
  readonly name = "DeadlineError";
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${Math.round(ms / 1000)}s ceiling and was stopped.`);
    this.label = label;
    this.ms = ms;
  }
}

/**
 * Runs `body` under a wall clock, handing it a signal that aborts when time runs out.
 *
 * The signal is the important half. Rejecting the outer promise on a timeout while the
 * work carries on underneath leaks a Chromium and an in-flight model call per timed-out
 * stage — the run "recovers" and the machine does not. Linking the parent signal means a
 * cancelled run collapses everything below it too.
 */
export async function withDeadline<T>(
  label: string,
  ms: number,
  body: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  // The deadline is *raced* against the body, not merely signalled to it.
  //
  // Signalling alone is not enough and the difference is the whole point of this
  // function: a body that ignores its signal — a hung MCP call, a fetch inside a library
  // that never wired cancellation through — leaves `await body(...)` pending forever, so
  // the stage hangs exactly as it did before there was a deadline. The race guarantees
  // this call returns. The signal is still fired, and still matters, because it is what
  // lets a well-behaved body actually stop and release its browser instead of running on
  // unobserved.
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const err = new DeadlineError(label, ms);
      controller.abort(err);
      reject(err);
    }, ms);
  });

  try {
    return await Promise.race([body(controller.signal), expiry]);
  } catch (err) {
    // The abort surfaces however the callee chose to report it — an `AbortError`, a
    // provider-specific cancellation, sometimes a generic failure. What we know for
    // certain is that our own timer fired, so that is what the caller is told.
    if (timedOut && !parent?.aborted) throw new DeadlineError(label, ms);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
    // Releases anything still listening on the derived signal once the stage is over.
    if (!controller.signal.aborted) controller.abort();
    // The race's losing side is a rejection nobody awaits once the winner has settled.
    // Without this, a body that finishes first leaves `expiry` to reject into an empty
    // room and Node reports an unhandled rejection — from the module whose entire job is
    // to stop failures propagating where they should not.
    expiry.catch(() => {});
  }
}

/**
 * A budget of seconds, shared across stages and spent as the run proceeds.
 *
 * The money ceiling in `run.ts` cannot see time, and on a slow production target time is
 * the constraint that actually binds: a run can crawl a marketing site for twenty
 * minutes on a couple of dollars of tokens, which is a lost demo at a cost the budget
 * guard is perfectly happy with.
 */
export class TimeBudget {
  private readonly startedAt = Date.now();
  readonly totalMs: number;
  constructor(totalMs: number) {
    this.totalMs = totalMs;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
  get remainingMs(): number {
    return Math.max(0, this.totalMs - this.elapsedMs);
  }
  get exhausted(): boolean {
    return this.remainingMs <= 0;
  }

  /**
   * What one stage may have: its own preferred ceiling, or whatever is left, whichever
   * is smaller. Never returns zero — a stage handed a zero-millisecond deadline fails in
   * a way that reads like a crash rather than like a budget, so the floor is a second.
   */
  sliceMs(preferredMs: number): number {
    return Math.max(1_000, Math.min(preferredMs, this.remainingMs));
  }
}
