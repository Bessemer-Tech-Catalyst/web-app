# Phase 5 handoff — Triage + Healer + ShopLite

> Scratch file for continuing this work in a fresh session. Delete it when Phase 6 lands.
> Everything below is either code that exists or something a real run showed. Where the
> two differ, it says so.

## Status

**Phase 5 is built and has not been through an orchestrated run.** `triage`, `proposeHeal`
and `rerun` are real and registered in `agents/index.ts`; `pnpm test` is 40 green, and
`typecheck`, `lint` and `build` are clean. On this project's own standard — "done means a
real run produced it", set after Phase 3 was marked done before it had ever run — that is
**not done**, and neither `PLAN.md` nor `docs/IMPLEMENTATION_PLAN.md` claims it is.

Phase 3 and Phase 4 each shipped code that typechecked, read correctly, and hid four
defects that only a live run found. Budget for the same here.

## The one thing to do next

Run it. §13.5 of the implementation plan has the exact commands; the short version:

```bash
pnpm dev --port 3002          # ALWAYS restart after editing src/server
# .env.local needs OPENAI_API_KEY and ODYSSEY_REAL_AGENTS=all
curl -sS -X POST localhost:3002/api/runs -H 'content-type: application/json' -d '{
 "url":"http://localhost:3002/shoplite",
 "credentials":{"username":"ada@shoplite.test","password":"lovelace"},
 "options":{"maxScenarios":3,"maxReplans":1,"budgetUsd":0.60}
}'
```

Then break ShopLite and run again:

```bash
curl -sS -X POST localhost:3002/api/shoplite/flags \
  -H 'content-type: application/json' -d '{"drift":true}'   # expect SCRIPT_DRIFT → heal
curl -sS -X POST localhost:3002/api/shoplite/flags \
  -H 'content-type: application/json' -d '{"defect":true}'  # expect APP_DEFECT → bug, no heal
```

The interesting demo shape is flipping a switch **between** GENERATE and EXECUTE on a
single run, so the suite is generated against a healthy app and executed against a broken
one. Nothing automates that yet; it is a curl in another terminal.

Files to read a run from: `.odyssey/runs/<id>/triage.json`, `selector-provenance.json`,
`results/failures.json` (new — the untruncated error text per failing test),
`heal/patch-*.diff`, `events.ndjson`.

## What to watch for on that first run

Educated guesses, not findings. Written down because the useful thing after a run is the
diff between what was expected and what happened.

1. **`readSignals` against real Playwright text.** The unit tests use error shapes written
   from memory of Playwright's format. They are close, but the first real failure is the
   thing that says whether `locator` is being extracted from the call log correctly. If the
   prior comes back "no known failure shape" on a normal timeout, that is the bug.
2. **`locatorWasProven` joining across two spellings.** The ledger holds canonicalised
   `page.…` chains; Playwright prints `getByRole('button', { name: 'x' })` with no `page.`
   and its own quoting. `prove()` canonicalises both sides, but this join has never seen a
   real pair.
3. **`PLAYWRIGHT_JSON_OUTPUT_NAME` in the rerun.** The rerun deliberately writes
   `results/rerun.json` rather than overwriting the suite's `results.json`, using
   `--reporter json` plus that env var. Verify a rerun actually produces the file; if not,
   every heal reports "the runner produced no report".
4. **Cost.** Triage is one agent run per failure and healing is one per attempt, both with
   a browser. Nothing has measured them. Set `budgetUsd` low on the first run — it is a
   real ceiling, enforced between units of work, and both new stages check it.
5. **Whether the classifier overturns the prior constantly.** If it does, either the priors
   are wrong or the damping is doing too much work. The `overrule_prior` tool events in the
   activity feed are the fastest way to see it.

## What was built, and the reasoning worth not re-deriving

- **`agents/failure-signals.ts`** — the rule-based prior. Two inputs: Playwright's own error
  text, and the generation-time locator ledger. Capped below 0.75 by design and by test: a
  prior has read a string, not looked at an application.
- **`agents/triage.ts`** — prior, then a live look with a **read-only** browser
  (`CLASSIFIER_TOOLS`: no click, no type). Overturning the prior without citing live
  evidence damps confidence to ≤0.45 and appends the reason to the model's own rationale.
  Over budget, it classifies from the prior alone and says so rather than returning nothing.
- **`agents/healer.ts`** — proposes a whole file, never a diff. Only locators the patch
  *introduces* are checked for provenance; the ones it kept were proven when the test was
  written. `rerun` is the executor's invocation narrowed to one file: same CLI, same config,
  same `keyOf` match that Phase 4's bug 2 taught us to use.
- **`orchestrator/patch.ts`** — the unified diff, computed from the same before/after the
  assertion guard checked, so the artifact and the file that runs cannot disagree.
- **`run.ts`** — applies an accepted patch (the orchestrator's act, not the Healer's),
  retries an `ENV_FLAKE` *before* patching it, files bugs under the classifier's own title,
  and distinguishes "the Healer proposed no patch" from "N attempts did not converge".
- **`executor.ts`** — now writes `results/failures.json` with untruncated error text.
  `TestResult.error` is clipped to 600 chars for the screen, and Playwright puts the cause
  of an actionability failure at the end of a call log longer than that. Triage classifies
  on exactly that tail.
- **ShopLite** (`src/app/shoplite/`) — the demo target, verified in a real browser: the
  negative sign-in path, an £84.00 basket total, an order visible in history by id, and a
  fresh context built from the captured `storageState` that is signed in with an **empty**
  basket. Both switches produce the failure shape they promise.

## Design notes that are decisions, not accidents

- **The classifier gets no click.** It is deciding whether the *application* is broken; one
  that can change the state it is reporting on is describing its own side effects. This is
  also why both ShopLite defects are diagnosable from a page load alone.
- **ShopLite's basket is `sessionStorage`, its session a cookie.** `storageState` carries
  cookies and `localStorage` and not `sessionStorage`, so the suite inherits the login and
  not the Generator's shopping. That is a concrete answer to the open finding in §12.3 —
  an example of an application without the problem, not a fix for the general case.
- **`bug` on `TriageOutcome` is optional.** The ledger files what the classifier named. The
  fallback title is the test's own; the orchestrator never invents a description of a defect
  nothing diagnosed. (That exact failure mode, sourced from `fixtures.ts`, was a Phase 3
  defect.)

## Still stubbed

`assessRisk` and `tracePrd` — Phase 6, along with report synthesis and the artifact viewer.
