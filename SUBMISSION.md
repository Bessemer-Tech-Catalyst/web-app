# Submission — Autonomous Test Orchestration Agent

**Bessemer Tech Catalyst · AI/ML Track · Aivar Innovations**
Project: **The Odyssey** · [README](README.md) · [Architecture](docs/architecture.svg) ·
[Demo run of show](docs/DEMO.md) · [Engineering log](docs/IMPLEMENTATION_PLAN.md)

---

## 1. What was asked for, and where it is

### Must Have

| # | Requirement | Where | Evidence you can check in a minute |
|---|---|---|---|
| 1 | Accept a URL as the **sole required input** and begin autonomously | [`validate.ts`](src/server/validate.ts) — `url` is the only field without a default | `curl -X POST /api/runs -d '{"url":"…"}'` starts a full run |
| 2 | A **Planner** sub-agent that explores and produces a human-readable plan covering meaningful flows, not just happy paths | [`agents/planner.ts`](src/server/agents/planner.ts) | `specs/core.md` in any run workspace — prose a person can disagree with, no selectors |
| 3 | **Evaluate the plan for coverage gaps before generation** — missing flows, edge cases, error states | [`agents/critic.ts`](src/server/agents/critic.ts), gate in [`orchestrator/run.ts`](src/server/orchestrator/run.ts) | `critique.json` — six dimensions scored 0–100 against Recon's observations; below 75 it re-plans against the gaps it named |
| 4 | A **Generator** sub-agent producing executable tests **with live selector and assertion validation** | [`agents/generator.ts`](src/server/agents/generator.ts), gate in [`agents/locator-provenance.ts`](src/server/agents/locator-provenance.ts) | `selector-provenance.json` — every locator Playwright itself resolved, checked mechanically against the emitted file |
| 5 | Run the suite and invoke a **Healer** on failures, **distinguishing a broken script from a genuine application defect** | [`agents/executor.ts`](src/server/agents/executor.ts), [`agents/triage.ts`](src/server/agents/triage.ts), [`agents/healer.ts`](src/server/agents/healer.ts) | `triage.json` — four verdicts; `APP_DEFECT` files a bug and **withholds the Healer** |
| 6 | A **final test quality report**: scenarios covered, pass/fail, healer actions, gaps remaining, untested flow risk | [`report-markdown.ts`](src/server/report-markdown.ts), [`report-view.tsx`](src/components/report/report-view.tsx) | `/runs/<id>/report` and `report.md` — all five sections, in that order |

### Good to Have

| Requirement | Status | Where |
|---|---|---|
| Optional **PRD** informing the Planner's scope | ✅ | `buildInput` in [`planner.ts`](src/server/agents/planner.ts); [`docs/shoplite-prd.md`](docs/shoplite-prd.md) is the demo's |
| **Natural-language intent** reflected in the plan | ✅ | `intent` reaches the Planner and the Generator — *"focus on checkout and authentication flows"* |
| **Parallel execution** across flows | ✅ | `parallelWorkers` in the generated `playwright.config.ts`. Pinned to 1 while the browser is headed on purpose: a watched run is the demo, and four simultaneous windows are unwatchable. `ODYSSEY_HEADLESS=1` restores full parallelism |

### Bonus

| Requirement | Status | Where |
|---|---|---|
| **PRD-to-test-plan gap analysis** | ✅ | [`agents/prd-trace.ts`](src/server/agents/prd-trace.ts), gated by [`prd-gate.ts`](src/server/agents/prd-gate.ts). Four states, not a tick — and `planned-only` is reported as **not covered** |
| **Defect classification** — script issue vs. genuine bug | ✅ | [`agents/triage.ts`](src/server/agents/triage.ts) + [`failure-signals.ts`](src/server/agents/failure-signals.ts). Rule-based prior from Playwright's own error text and the generation-time locator ledger, then a **read-only** live look. A model verdict that overturns the prior without citing something it saw live is damped, and the report says so |

### Out of scope, and respected

No CI/CD integration, no cross-browser matrix, no production hosting, and **not one
hand-written test** — every line of every `.spec.ts` in every run workspace was produced
by the Generator.

---

## 2. Submission artifacts

| Required | Here |
|---|---|
| Working prototype running live on a target | `pnpm dev` + bundled **ShopLite** target at `/shoplite`, or any URL |
| Source repository with setup instructions | This repo. [README § Running it](README.md#running-it) |
| README: architecture, pipeline design, how to run | [README.md](README.md) |
| **Architecture diagram** | [`docs/architecture.svg`](docs/architecture.svg) — and as Mermaid in the README |
| Demo video (2–5 min) | Script and run of show: [`docs/DEMO.md`](docs/DEMO.md) |
| Presentation deck | [`docs/the-odyssey-deck.pptx`](docs/the-odyssey-deck.pptx) — problem, approach, trade-offs, business impact |

---

## 3. The three ideas we would defend in a viva

**1. The sub-agents are table stakes; the orchestrator is the product.** Playwright ships
a Planner, a Generator and a Healer today — `npx playwright init-agents` installs all
three for free — and its own documentation tells you to keep a human approval gate after
each. This system deletes those three humans and replaces them with judgments that show
their working. Four of them are marked ★ on the diagram.

**2. Every number in the report is measured or it is not printed.** Coverage is read off
the emitted suite — a route counts as exercised when a test that actually *ran* contains
that path — and the report prints which signal made each attribution, so a weak claim
looks weak. Risk scores come from a published weight table anybody can recompute. The
model may adjust a score by ±15, and an adjustment that cites nothing the factors missed
is **discarded, not damped**. None of the scoring layer needs a model, so the risk ledger
is real with no API key at all.

**3. The controls are mechanical, not prompted.** Three examples, each of which has
already caught the model in a live run:
- the **locator provenance gate** — a selector not in the session's resolved-locator
  ledger is a guess, whatever the agent says about it;
- the **assertion guard** — the assertion set is diffed before and after every patch;
  delete, weaken, negate or re-value one and the patch is rejected and the test
  escalates. It fired on a patch whose own summary claimed no assertions changed;
- the **citation index check** — a risk the model adds must cite a Recon observation *by
  index*, checked against the array, or the row is dropped.

---

## 4. How to check the claims yourself

```bash
pnpm install && pnpm verify        # typecheck · lint · 117 assertions, ~2s, no API, no browser
pnpm dev --port 3002               # with OPENAI_API_KEY and ODYSSEY_REAL_AGENTS=all in .env
pnpm demo:reset && pnpm demo:run   # ShopLite, with the PRD and an intent
pnpm run:tail <runId>              # the event log, one line per decision
```

Every run leaves a directory that is itself the evidence — plan, tests, config, patches,
traces, coverage, risk, PRD trace, report, and the append-only event log the whole
console is rendered from. Nothing in the report is computed anywhere else.

---

## 5. What is not finished, stated rather than implied

- The `storageState` hand-off carries the agents' own side effects into the generated
  suite: if Recon creates a record while crawling, the suite starts with it present.
  ShopLite shows what an application immune to this looks like — its basket lives in
  `sessionStorage`, which `storageState` does not carry — which routes around the problem
  rather than solving the general case.
- The defect classifier cannot know which `storageState` the suite ran with, so a failure
  caused by an unexpected session is harder for it to attribute than one caused by a 500.
- The fleet-level pages in the console — Overview, Coverage, Defects, Schedule, Targets —
  describe the product around a single run and are driven by seeded data. **Every one of
  them says so on the page**, and every number inside a run is measured by that run.
