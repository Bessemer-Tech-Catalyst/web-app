# Phase 5 handoff — closed by `run_8b37144b`

> Scratch file for continuing this work. Delete it when Phase 6 lands.

## Status

**Phase 5 is done and a live run proved it.** `run_8b37144b`, against a local ShopLite with both
defect switches flipped **between GENERATE and EXECUTE**:

- `APP_DEFECT` at **0.94** on the 500, bug titled by the classifier, **Healer withheld, test left
  red**
- `SCRIPT_DRIFT` on the renamed control — prior said flake, the live look overturned it, one-line
  patch, re-run green, reported `healed`
- `ENV_FLAKE` retried once before any patch; it reproduced, went to the Healer, and the
  **assertion-integrity guard rejected the patch** — the Healer's summary claimed it had changed
  no assertions and the diff said otherwise
- 3 tests generated, 0 quarantined, provenance 5/5 · 24/24 · 5/5. **$0.161.**

Full account, including the three defects the run exposed, in §13.6–13.7 of
`docs/IMPLEMENTATION_PLAN.md`.

## What is open

1. **A signed-out scenario versus a signed-in suite.** The Generator now gets told to write
   `test.use({ storageState: { cookies: [], origins: [] } })` for scenarios about anonymous or
   rejected-credential behaviour. **That prompt change has not been through a run.** Verify it on
   the next ShopLite run — the Planner reliably plans such a scenario, so it will come up.
2. **The classifier has no way to know the suite arrives holding a session the Generator did not
   have.** It called the case above `ENV_FLAKE` at 0.70, having navigated to the page and seen the
   heading it wanted. A `PLAN_ERROR`/state-variant signal would need the run to tell triage what
   `storageState` the suite ran with. Unbuilt, and a good idea.
3. **Side effects still reach the suite** on a target that persists them (§12.3). Unchanged.
4. **`assessRisk` and `tracePrd` are still stubs** — that is Phase 6, which is next.

## Reproducing the demo

```bash
pnpm dev --port 3002                      # restart after any src/server edit
curl -sS -X POST localhost:3002/api/shoplite/flags \
  -H 'content-type: application/json' -d '{"drift":false,"defect":false}'
curl -sS -X POST localhost:3002/api/runs -H 'content-type: application/json' -d '{
 "url":"http://localhost:3002/shoplite",
 "credentials":{"username":"ada@shoplite.test","password":"lovelace"},
 "options":{"maxScenarios":3,"maxReplans":1,"budgetUsd":0.90,"maxHealAttemptsPerTest":2}
}'
```

Then break it the moment generation ends — that is what makes the classification real rather than
a scenario generated against an already-broken app:

```bash
F=.odyssey/runs/<id>/events.ndjson
until grep -q '"type":"stage.exited","stage":"generate"' "$F"; do sleep 0.2; done
curl -s -X POST localhost:3002/api/shoplite/flags \
  -H 'content-type: application/json' -d '{"drift":true,"defect":true}'
```

On stage, do that flip by hand on `/shoplite/control` while the Generator is still working — it is
a better moment than a script, and generation takes about two and a half minutes.

**Timing, measured on this machine.** recon ~42s · plan ~10s · critique ~17s (×2 with a re-plan) ·
generate ~155s · execute ~110s (a timing-out test costs its full 90s) · triage ~69s · heal ~180s.
About nine minutes end to end. For a four-minute demo slot, run it live to the classifier's verdict
and replay the rest.

## Files a run is debugged from

`.odyssey/runs/<id>/` — `triage.json` (verdicts and evidence), `selector-provenance.json` (ledger
and proof per scenario, including quarantined ones), `results/failures.json` (untruncated error
text per failing test), `heal/patch-*.diff`, `results/state.json` (the session hand-off),
`events.ndjson`.
