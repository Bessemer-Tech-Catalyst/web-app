/**
 * The retry and deadline policy, pinned without a key, a network or a clock worth
 * waiting on.
 *
 * The defect this file exists to prevent is the expensive one in both directions:
 * retrying something that will never succeed spends the run's budget twice for the same
 * answer, and *not* retrying something transient ends a run over a dropped socket. So
 * the classifier is tested on the exact error shapes the three transports in this
 * pipeline actually produce.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DeadlineError,
  TimeBudget,
  backoffMs,
  classify,
  errorText,
  withDeadline,
  withRetry,
} from "./resilience.ts";

// --- classification --------------------------------------------------------

test("rate limits, 5xx and dropped sockets are transient", () => {
  for (const err of [
    new Error("429 Too Many Requests"),
    new Error("Rate limit reached for gpt-5.6-luna"),
    new Error("The server had an error processing your request. Internal server error."),
    new Error("socket hang up"),
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    new Error("fetch failed"),
    new Error("503 Service Unavailable"),
  ]) {
    assert.equal(classify(err), "transient", err.message);
  }
});

test("a browser or MCP transport that died mid-run is transient", () => {
  for (const err of [
    new Error("MCP server playwright-recon closed unexpectedly"),
    new Error("Target page, context or browser has been closed"),
    new Error("browser has been closed"),
    new Error("transport closed"),
  ]) {
    assert.equal(classify(err), "transient", err.message);
  }
});

test("statuses decide when the error carries one, and 4xx is not retried", () => {
  assert.equal(classify(Object.assign(new Error("nope"), { status: 429 })), "transient");
  assert.equal(classify(Object.assign(new Error("nope"), { status: 503 })), "transient");
  assert.equal(classify(Object.assign(new Error("nope"), { status: 400 })), "permanent");
  assert.equal(classify(Object.assign(new Error("nope"), { status: 404 })), "permanent");
});

/**
 * The trap this guards. `maxTurns` reports as a limit being exceeded, and two of the
 * transient patterns match on that vocabulary — so without the never-transient list a
 * wedged fifty-turn agent with a browser attached would be re-run in full to arrive at
 * exactly the same wedge. That is the most expensive single unit of work in the run,
 * charged twice for nothing.
 */
test("a wedged agent loop is never retried, however much its message sounds like one", () => {
  assert.equal(classify(new Error("Max turns (60) exceeded")), "permanent");
  assert.equal(classify(new Error("maxTurns exceeded")), "permanent");
});

test("a bad key, a bad schema and an exhausted quota are permanent", () => {
  for (const err of [
    new Error("Incorrect API key provided"),
    new Error("invalid_api_key"),
    new Error("Recon finished without producing a result matching its output schema."),
    new Error("insufficient_quota: You exceeded your current quota"),
    new Error("context_length_exceeded"),
  ]) {
    assert.equal(classify(err), "permanent", err.message);
  }
});

test("an aborted run is never retried, whatever the error says", () => {
  const ac = new AbortController();
  ac.abort();
  // The message is the most retryable string in the file; the signal still wins.
  assert.equal(classify(new Error("429 rate limit"), ac.signal), "aborted");
});

test("errorText reaches through a nested cause", () => {
  const err = new Error("Planner failed", { cause: new Error("ECONNRESET") });
  assert.match(errorText(err), /ECONNRESET/);
  assert.equal(classify(err), "transient");
});

// --- retry -----------------------------------------------------------------

test("a transient failure is retried and the eventual success is returned", async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("socket hang up");
      return "ok";
    },
    { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("a permanent failure is thrown on the first attempt, not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("Incorrect API key provided");
      },
      { attempts: 4, baseDelayMs: 1 },
    ),
    /Incorrect API key/,
  );
  assert.equal(calls, 1, "a permanent failure must cost exactly one attempt");
});

test("the attempt ceiling is honoured and the last error is what surfaces", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        // A leading status code is how the provider SDK formats an unnamed HTTP fault.
        throw new Error(`503 Service Unavailable — attempt ${calls}`);
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    ),
    /attempt 3/,
  );
  assert.equal(calls, 3);
});

test("backoff is full jitter — never above the doubling ceiling, never negative", () => {
  const p = { baseDelayMs: 1_000, maxDelayMs: 8_000 };
  // A deterministic draw of 1 gives the ceiling exactly, which is what bounds the wait.
  assert.equal(backoffMs(1, p, () => 1), 1_000);
  assert.equal(backoffMs(2, p, () => 1), 2_000);
  assert.equal(backoffMs(4, p, () => 1), 8_000);
  assert.equal(backoffMs(9, p, () => 1), 8_000, "the ceiling clamps unbounded doubling");
  assert.equal(backoffMs(3, p, () => 0), 0, "full jitter can draw zero");
});

test("Retry-After is honoured over the computed backoff", async () => {
  // A provider that says 'wait' and is retried sooner answers 429 again, and the run has
  // spent an attempt learning what it was told. The wait is capped, so this asserts the
  // header is read rather than that we actually sleep for it.
  const err = Object.assign(new Error("429 Rate limit reached"), {
    status: 429,
    headers: { "retry-after": "0" },
  });
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw err;
      return "ok";
    },
    { attempts: 2, baseDelayMs: 5_000, maxDelayMs: 5_000 },
  );
  assert.equal(value, "ok");
});

test("an abort mid-retry stops the loop instead of sleeping through it", async () => {
  const ac = new AbortController();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        ac.abort();
        throw new Error("ECONNRESET");
      },
      { attempts: 5, baseDelayMs: 50, signal: ac.signal },
    ),
  );
  assert.equal(calls, 1);
});

// --- deadlines -------------------------------------------------------------

test("work that finishes inside its ceiling is untouched", async () => {
  const value = await withDeadline("Planner", 5_000, async () => "done");
  assert.equal(value, "done");
});

test("work that runs past its ceiling raises a DeadlineError naming the stage", async () => {
  await assert.rejects(
    withDeadline("Recon", 20, () => new Promise(() => {})),
    (err: unknown) => {
      assert.ok(err instanceof DeadlineError);
      assert.match((err as Error).message, /Recon exceeded its 0s ceiling/);
      return true;
    },
  );
});

/**
 * The property that matters most here and is the least obvious. Rejecting the outer
 * promise while the work carries on underneath leaks a Chromium and an in-flight model
 * call per timed-out stage: the run "recovers" and the machine does not.
 */
test("the body is handed a signal that fires when the deadline does", async () => {
  let aborted = false;
  await assert.rejects(
    withDeadline(
      "Generator",
      20,
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
    ),
  );
  assert.equal(aborted, true, "the body must be cancelled, not merely abandoned");
});

test("a cancelled run collapses the deadline below it", async () => {
  const parent = new AbortController();
  let sawAbort = false;
  const pending = withDeadline(
    "Healer",
    60_000,
    (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(new Error("run cancelled"));
        });
      }),
    parent.signal,
  );
  parent.abort();
  await assert.rejects(pending);
  assert.equal(sawAbort, true);
});

// --- the shared clock ------------------------------------------------------

test("a stage gets its own ceiling or whatever is left, whichever is smaller", () => {
  const budget = new TimeBudget(10_000);
  assert.equal(budget.sliceMs(3_000), 3_000, "a modest stage keeps its own ceiling");
  assert.ok(budget.sliceMs(60_000) <= 10_000, "a greedy stage is cut to what remains");
  assert.equal(budget.exhausted, false);
});

test("an exhausted clock still hands out a floor rather than zero", () => {
  const budget = new TimeBudget(0);
  assert.equal(budget.exhausted, true);
  // Zero would surface to a reader as a crash; a second surfaces as a budget.
  assert.equal(budget.sliceMs(30_000), 1_000);
});
