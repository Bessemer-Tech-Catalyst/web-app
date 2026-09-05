# Phase 6 handoff — built, unit-pinned, owes a live run

> Scratch file for continuing this work. Delete it when Phase 7 lands.

## Status

**Phase 6 is built and every deterministic layer is pinned by tests. It has not been through a
complete live run with real agents.** Every previous phase in this repo was marked done once
before it had ever run, and running it found defects each time — so the label until a real run
exists is "built", not "done".

One real run was started and cancelled by hand partway through: `run_af7ae3f9`, against
`http://localhost:3000/shoplite` with a PRD written for it (§2.5 describes a password reset the
app does not implement, which is the `planned-only` case item 5 below is waiting on). It
authenticated, mapped 4 routes, planned 4 scenarios, critiqued them, and was cancelled inside
`generate` at $0.066. **It therefore proves nothing about the six checks below** — none of them
read a stage it reached. Its state is on disk if it is worth reading.

The key is no longer the obstacle: copy the main checkout's `.env` (`OPENAI_API_KEY`,
`ODYSSEY_REAL_AGENTS=all`) into this worktree — `next dev` reloads it without a restart.

What landed:

- **`assessRisk` and `tracePrd` are real** in `agents/index.ts`. Nothing on the `Agents` interface
  is a stand-in any more. This closes the brief's last Must Have (the final test quality report,
  including untested flow risk) and its first Bonus (PRD-to-test-plan gap analysis).
- **`report.md`** beside `report.json` — the same report as a document you can open a PR with.
- **`GET /api/runs/:id/artifacts/*`** so the report *shows* the screenshot of the page at the
  moment a test died, instead of naming a path on a disk the reader does not have.
- **101 unit assertions**, up from 40.

Full account in §14 of `docs/IMPLEMENTATION_PLAN.md`.

## Two defects it found in our own code, before any model ran

1. **The report's "Scenarios covered" table was broken on every live run.** It looked results up
   by `t-${scenario.id}`, a shape only `fixtures.ts` produces; the real Generator names a test
   after its scenario. So a fully executed suite rendered as `pending` from top to bottom — in the
   one table the Must Have names first. Fixed as `lib/report-join.ts`, pinned.
2. **The coverage map rebuilt spec filenames from scenario ids** instead of reading
   `GeneratedTest.file`. Correct for flat paths, silently wrong for nested ones — the navigation
   signal simply vanished and every surface reported as untested. Third time in this repo a key
   has been reconstructed instead of carried.

Both fail the same way: not with an error, with a plausible-looking table.

## What to verify on the first real run

```bash
cp ../../../.env .              # OPENAI_API_KEY + ODYSSEY_REAL_AGENTS=all
pnpm dev --port 3002            # check first: a server for this worktree may already be up
curl -sS -X POST localhost:3002/api/runs -H 'content-type: application/json' -d '{
 "url":"http://localhost:3002/shoplite",
 "credentials":{"username":"ada@shoplite.test","password":"lovelace"},
 "prd":{"filename":"shoplite-prd.md","text":"..."},
 "options":{"maxScenarios":4,"maxReplans":2,"budgetUsd":0.90,"maxHealAttemptsPerTest":2}
}'
```

Then check, in this order — these are the claims that have never been exercised by a model:

1. **`risk.json` — did the model adjust anything, and was the adjustment kept or discarded?**
   A discard emits an `agent.tool` event reading *"Discarded a ±N adjustment … no justification
   given, so the computed N stands."* Either outcome is correct; what matters is that the gate
   fires and the report shows `priorScore` beside any score that moved.
2. **Did it add a non-route surface, and did the observation index check hold?** An uncited row is
   dropped with a tool event naming it. ShopLite has few such surfaces, so an empty `added` list is
   the expected answer and a *populated* one deserves reading.
3. **`prd-trace.json` — are the `quote` fields actually verbatim?** Grep one against the PRD text.
   This is the check a judge can repeat in ten seconds, so it has to hold.
4. **Are any citations struck out?** `invented` in `prd-trace.json`, and the
   `verify_scenario_references` tool event.
5. **Does `/forgot-password` come out `planned-only`?** The Planner reliably plans a password-reset
   scenario on ShopLite and the Generator reliably quarantines it (real outbound email), which is
   the exact case the ledger's third state exists for. If it does, that is the demo line.
6. **`coverage.json` — how many attributions are `navigation` rather than `scenario-text`?** The
   real Generator writes `page.goto` calls, so navigation should dominate. If it does not, the
   emitted suite is reaching pages by clicking and the report is telling the truth about a weaker
   signal — worth knowing either way, not a bug.

## Still open from earlier phases

- A signed-out scenario versus a signed-in suite (Phase 5, item 1) — the Generator prompt change
  has still not been through a run.
- The classifier cannot know what `storageState` the suite ran with (Phase 5, item 2).
- Side effects still reach the suite on a target that persists them (§12.3).
