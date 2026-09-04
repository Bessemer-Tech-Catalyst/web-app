# Phase 4 handoff — Generator + Executor

> Scratch file for continuing this work in a fresh session. Delete it when Phase 5 lands.
> Everything below is what has actually been observed; trust it over inference.

## Status

**Phase 4 is implemented and has been exercised end to end by real runs.** The pipeline
generates tests whose every locator was resolved on the live page, executes them with the
project's own Playwright, and reports the outcome faithfully — including real failures
with their real error text.

Four bugs were found by running it. All are fixed; each is described below with the
evidence that found it, because each was invisible to typechecking and to reading.

## What real runs established

| Run | Target | Result |
|---|---|---|
| `run_da67bd80` | app.docxion.com | Died at scenario 4/10 on max turns. Emitted 1 test, 17/17 locators proven. |
| `run_b28e78fe` | app.docxion.com | 10/10 quarantined, 0 tests, correctly reported `failed`. |
| `run_6ed4bb62` | demo.playwright.dev/todomvc | 1 test emitted (4/4 proven), executed, failed on a genuine finding. $0.08. |

Verified working, with the observation that proves it:

- **Auth hand-off.** `results/state.json` carried 0 cookies and **4 localStorage entries**
  on the clinic app — exactly the case `storage-state.ts` exists for, since that target
  has no session cookie. Reproduced on two runs.
- **The provenance gate is not too strict.** Scenarios emitted at 17/17 and 4/4.
- **Quarantines are honest.** "The live session is signed in, and navigating to /login
  immediately redirects to /org/my-clinic" is a real reason, not a hedge.
- **`### Error` sniffing.** Browser-side failures land as `ok: false`.
- **The executor's whole path.** CLI resolved from `@playwright/test`, config valid,
  `storageState` genuinely authenticates the suite, JSON report parsed, failure
  screenshot + video + trace captured and emitted as artifacts.
- **Zero-test runs report `failed`**, with an error event saying why.

## The four bugs, and how each was found

1. **A wedged scenario killed the whole run.** `Max turns (40) exceeded` on scenario 4 of
   10 threw out of the loop, discarding the nine scenarios after it, the one test already
   emitted, and the provenance record. `generator.ts`'s own header promised the opposite.
   Now caught per scenario: it quarantines with the error as its reason and carries on.
   Aborts still propagate, so a cancelled run is not reported as ten quarantines.
   *Found by: letting the previous session's run finish instead of assuming it was dead.*

2. **The executor matched no test to its own report.** Playwright sets `config.rootDir` to
   the common ancestor of the collected specs — the `tests/` directory — so the report
   names a file `foo.spec.ts` while the run recorded `tests/foo.spec.ts`. The old
   comparison was a string tidy-up whose comment asserted, wrongly, that rootDir was the
   run workspace. Since an unmatched generated test is reported as a failure, **a suite
   that passed every test would have reported as a suite that failed every test.**
   Now both sides resolve against their own root and re-relativise.
   *Found by: running an emitted suite through the executor's exact invocation and
   reading the JSON report, rather than trusting the comment.*

3. **`budgetUsd` did not stop the stage that spends the money.** It gated only re-planning
   and healing, while `generate` — 86% of the bill, one live browsing agent per scenario —
   ignored it. The Decision Log meanwhile said the orchestrator "degrades gracefully and
   reports what it has rather than pressing on". `AgentContext.overBudget()` now exists and
   the generator stops between scenarios, holding the unrun ones as reported rather than
   silently missing.
   *Found by: looking for what `budgetExceeded` was actually read by.*

4. **Run artifacts leaked into the repo root.** The HTML reporter had no `outputFolder`, so
   it wrote `playwright-report/` beside the project's package.json — outside the run
   workspace, and overwritten by every subsequent run — three lines below a comment
   promising every artifact stays inside the run's workspace. Both reporters are now pinned
   to `results/`.
   *Found by: `git status` after a run.*

Also: failed tool output keeps its **tail** as well as its head (`elide`, harness.ts).
Playwright puts the cause of an actionability failure on the last line of the call log, so
head-only truncation at 200 chars discarded exactly the diagnostic and left "locator
resolved to <button class=…". That is why bug 1 took a whole run to diagnose.

`MAX_TURNS_PER_SCENARIO` was raised 40 → 80 on measurement: four scenarios were cut off
mid-proof holding 12/35/11/17 resolved locators, with a tool mix that reads as work
(31 `browser_generate_locator` in one, 8 `select_option` + 8 `verify_value` in another),
not as the flailing signature of twenty consecutive `browser_press_key` calls.

## Two design findings, not yet addressed

Both were surfaced by the TodoMVC run and are architecture decisions, so they were left
alone rather than quietly changed.

1. **The storage-state hand-off carries the agents' own side effects into the suite.**
   Recon created a todo while crawling; `captureStorageState` dumped it; the suite started
   with `"Recon sample"` already present; the generated test added a second todo and died
   on `strict mode violation: getByTestId('todo-title') resolved to 2 elements`. On a
   credentialed app this is mostly benign — the session is the point — but any record the
   agents create becomes suite fixture data.
2. **Scenarios are not isolated from each other during generation.** They share one browser
   session by design (that is how the login survives), so scenario 1's created data is
   visible to scenario 2 — which then quarantined because it could not reach a fresh empty
   list. Correct behaviour given the design; worth deciding on deliberately.

A third, about the target rather than the pipeline: three scenarios across two runs hit
*"another navigation button intercepted pointer events"* on app.docxion.com (New
appointment, Add patient, the WhatsApp control). Note that generation browses at 900×620
while the generated suite runs at `Desktop Chrome` 1280×720, so a locator is proven at one
viewport and exercised at another. Whether the overlap is a real app defect or an artifact
of the small MCP viewport has not been established.

## ~~Not yet proven~~ — closed by `run_7408ff5f`

**A full orchestrated run has now produced a green suite.** Against
`https://playwright.dev/`, 2 scenarios, critique 82 accepted on the first pass:

- 2 tests emitted, locator provenance **14/14** and **20/20**
- executed by the real runner: **`expected: 2, unexpected: 0, flaky: 0`**
- run finished `succeeded`, **$0.317**

Worth keeping: the report's `config.rootDir` was `<workspace>/tests`, the exact shape of
bug 2 — and both tests still matched. That is the fix working in production rather than
in a test.

Taken by the first of the two routes this section offered: **a target that does not
persist agent side effects.** Design finding 1 below is therefore still open and
undecided — the read-only target routes around it, it does not resolve it. A green run on
a target that *does* persist what the agents do still requires that decision.

## Running it

```bash
# .env already has OPENAI_API_KEY and ODYSSEY_REAL_AGENTS=all
pnpm dev --port 3002        # ALWAYS restart after editing src/server
curl -sS -X POST localhost:3002/api/runs -H 'content-type: application/json' -d '{
 "url":"https://demo.playwright.dev/todomvc",
 "options":{"maxScenarios":3,"maxReplans":0,"budgetUsd":0.30}
}'
# then watch .odyssey/runs/<id>/events.ndjson
```

**Cost model, measured.** A 10-scenario clinic run is ~$0.44: recon $0.045, plan+critique
$0.019, and generate **$0.378** — 86%, and roughly linear in scenario count at ~$0.04
each (more now that the turn ceiling is 80). 2.08M input tokens, nearly all of it browser
snapshots accumulating across turns. To test cheaply: cut `maxScenarios`, set
`maxReplans: 0`, and set `budgetUsd` low — it is now a real ceiling. TodoMVC costs about a
tenth of the clinic app per scenario because its snapshots are tiny.

`.odyssey/runs/<id>/selector-provenance.json` records the ledger and the proof for every
scenario, including the ones that failed, and is the file to debug a run from.

## Tests

Both are now in the repo and in a runner: **`pnpm test`** — 19 assertions, ~0.4s, no API
and no browser.

- `src/server/agents/locator-provenance.test.mts` — the provenance gate.
- `src/server/agents/report-keys.test.mts` — the report-to-generated-test match, pinned
  against a real unedited Playwright JSON report in `src/server/agents/__fixtures__/`.
  The regression test for bug 2.

`specsIn`/`keyOf` moved out of `executor.ts` into `report-keys.ts` so the test can import
the *real* functions: `executor.ts` cannot be loaded outside Next, so the old scratchpad
test was a hand-copy that its own comment admitted could drift.

One thing the port corrected: `prove` dedupes locators on the text **as the model wrote
it**, not on the canonical form, so the same locator in two quoting styles counts twice in
`selectorsTotal`. It cannot turn an unproven locator into a proven one — only the
denominator moves — so the test pins the real behaviour rather than the expected one.

## Housekeeping

- Ask the user before starting Phase 5 (Triage + Healer).
- Triage/heal are still stubbed, so no bugs are filed and red tests are reported
  unclassified. The report says so rather than claiming red tests are confirmed defects.
- ~~`docs/IMPLEMENTATION_PLAN.md` §11 and `PLAN.md` still describe Phase 4 as not
  started.~~ Done: §11 is now marked closed item by item, §12 records what the live runs
  showed, the phase table reads **4 ✅ / 5 ◀ now**, and `PLAN.md` leads with the green run
  *and* with what it deliberately does not claim.
