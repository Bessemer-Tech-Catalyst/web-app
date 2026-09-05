# The Odyssey — Implementation Plan (working doc)

> Internal engineering plan. The human-facing summary lives in [`../PLAN.md`](../PLAN.md).
> Target: Bessemer Tech Catalyst — AI/ML Track — *Autonomous Test Orchestration Agent*.

---

## 0. The strategic read

**The single most important fact from research:** Playwright ships its own
`Planner`, `Generator`, and `Healer` agents (`npx playwright init-agents --loop=<client>`).
The problem statement names those three agents *verbatim*. It then says:

> "What they do not do is orchestrate these capabilities end to end — deciding when to plan,
> when to generate, when to heal, and when to escalate — without a human directing each step."

So the brief is not "reimplement Playwright agents." The brief is: **build the meta-agent that
Playwright deliberately left out**, because Playwright's official guidance is to *keep a human
approval gate after planning, generation, and healing.* We are removing the human from those
three gates and replacing them with machine judgment.

**Therefore every point of differentiation must live in the orchestrator, not the sub-agents.**
Teams that build "URL in → tests out" will all look identical. The scoring rubric weights
*Innovation — how intelligently does the orchestrator handle coverage gaps, ambiguity, and
failure classification* at 20%, and *Functionality — runs end to end without manual
intervention* at 30%. Those 50 points are decided by the four judgment components in §3.

### Competitive intel (what exists, what to borrow, what to avoid)

| Project | Architecture | Take | Avoid |
|---|---|---|---|
| [Playwright test agents](https://playwright.dev/docs/test-agents) | 3 markdown agent defs (`planner`/`generator`/`healer`) + `seed.spec.ts` + `specs/*.md` → `tests/*.spec.ts`, driven by Playwright MCP | **Adopt the file contract wholesale** — `specs/*.md` plan format, `tests/` output, seed test for auth. Ecosystem parity = free credibility | Their human approval gates; their agents are meant for an interactive IDE loop |
| [testzeus-hercules](https://github.com/test-zeus-ai/testzeus-hercules) | Python, **LangGraph state machine**, planner node → executor node → nav helpers (`browser_nav_agent`, `api_nav_agent`, …), injects an `md` attribute into DOM as primary selector, returns *compact JSON* not raw HTML | **The DOM-compaction idea is the real lesson** — never feed raw HTML to the model, feed a compacted interactive-element digest. Also: explicit state machine over free-form agent chatter | Gherkin as the input format (we take a URL); AGPL-3.0 licence contamination — read it, don't copy it |
| [autonoma](https://github.com/autonoma-ai/autonoma) | TS monorepo, Hono+tRPC, Postgres/Prisma, Redis, **Temporal** for workflow orchestration, Playwright + Appium, vision models, BSL licence | Their **failure-report shape** (screenshots + video + suspected source lines + bug-vs-flake classification) is basically our final report. Temporal proves durable-workflow framing is right | Temporal/Redis/Postgres is a week of infra for a hackathon. We get 90% of it with an in-process FSM + append-only event log |
| Skyvern, Octomind, TestSprite, auto-playwright, AgentQL, ZeroStep | vision-first or `ai()`-helper-in-test approaches | Nothing structural | Vision-first is slow, expensive and flaky vs. the accessibility tree. Playwright MCP's a11y snapshot is deterministic and ~10× cheaper |

**Conclusion:** accessibility-tree-first (not vision-first), explicit state machine (not free-form
agent chatter), Playwright's file contract (not a bespoke format), in-process durable event log
(not Temporal).

---

## 1. Name

**The Odyssey.** A long, self-directed journey across unknown territory — which is what the agent
does to an application it has never seen. This is the name in the code: the run workspace is
`.odyssey/`, the environment variables are `ODYSSEY_*`, and the UI and app icon agree.

> **Superseded:** this document originally specified **Crucible** (a Bessemer converter *is* a
> crucible — air blasted through molten iron until the impurities burn off). The rename landed in
> `336e829`. Noted so the metaphor is not lost for the deck, and so nobody re-opens the decision.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Next.js 16 App Router (UI)                                      │
│  /              launcher — URL, PRD, intent, creds, budget      │
│  /runs/[id]     mission control — live decision stream          │
│  /runs/[id]/report   test quality report                        │
└───────────────┬─────────────────────────────────────────────────┘
                │ SSE: GET /api/runs/:id/events  (replay + live tail)
┌───────────────▼─────────────────────────────────────────────────┐
│ ORCHESTRATOR  (Node, in-process, one durable FSM per run)       │
│                                                                  │
│  INIT → RECON → PLAN → CRITIQUE ─┬─(gaps, budget left)→ PLAN    │
│                                   └─(pass)→ GENERATE            │
│  GENERATE → VALIDATE → EXECUTE → TRIAGE ─┬─(script)→ HEAL       │
│                                           ├─(flake)→ RETRY      │
│                                           ├─(defect)→ BUG LEDGER│
│                                           └─(plan err)→ BACKLOG │
│  HEAL → EXECUTE (bounded) → REPORT → DONE                       │
│                                                                  │
│  Every transition emits a DecisionEvent{state, action, rationale,│
│  evidence[], confidence, cost} → events.ndjson + SSE             │
└──┬────────────┬────────────┬────────────┬───────────────────────┘
   │            │            │            │
┌──▼─────┐ ┌────▼─────┐ ┌────▼───┐ ┌──────▼──────────────────────┐
│Planner │ │Generator │ │Healer  │ │ Critic · Classifier · Risk  │
│subagent│ │subagent  │ │subagent│ │ (structured-output calls)   │
└──┬─────┘ └────┬─────┘ └────┬───┘ └─────────────────────────────┘
   └────────────┴────────────┴──→ Playwright MCP (a11y snapshots,
                                   click/type/navigate) + FS + Bash
```

### Stack decisions

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 16 App Router, TS strict, Tailwind v4 | One process serves UI *and* hosts the orchestrator. Route handlers on the Node runtime can spawn Playwright. |
| Agent harness | `@openai/agents` (v0.17.x) | `Agent` takes `mcpServers` (`MCPServerStdio` / `MCPServerStreamableHttp`), `tools`, `handoffs` and `outputType`; `run(..., { stream: true })` gives us the narration the Decision Log renders, and per-request `usage` feeds the cost meter. |
| Agent file/shell access | Our own `tool()` definitions over the run workspace | Unlike the Claude Agent SDK there is no built-in Read/Write/Edit/Bash — which suits us: each agent gets a narrow, workspace-scoped allowlist, and a generator that can `rm -rf` is a liability (§4). |
| Judgment calls | `openai` SDK, Responses API with a strict JSON schema | Critic / Classifier / Risk must return typed JSON, not prose. Don't use an agent loop for a single scored decision. |
| Browser control | `@playwright/mcp` (a11y-tree snapshots) | Deterministic, no vision model, ~10× cheaper than screenshots. `--isolated --headless --port` for programmatic HTTP transport. |
| Test runtime | Real `@playwright/test` in a per-run workspace | Generated tests must be *real artifacts a team can commit*. Judge-checkable. |
| Persistence | Append-only `events.ndjson` per run + `runs.json` index | See §2.1. |
| Live transport | SSE (not WebSocket) | One-way, reconnect-for-free, trivially replayable from the ndjson file. |

### 2.1 Persistence — and the Supabase question

**Verdict: no Supabase, no Postgres, no Redis for the hackathon build.** Reasoning:

1. Playwright needs a real Node host with browser binaries. Supabase Edge Functions cannot run
   it, so a Node backend exists *no matter what* — Supabase would be an *additional* tier, not a
   replacement for one.
2. Every run is single-tenant and short-lived. The only genuinely relational query we ever make
   is "list recent runs."
3. Artifacts (traces, videos, screenshots, `.spec.ts` files) are files. Playwright's own tooling
   (`show-report`, `trace viewer`) expects them on disk. Putting them in object storage means
   downloading them back before we can render them.
4. **Demo risk.** Hackathon wifi is hostile. Every network dependency is a way to fail on stage
   in front of judges. Local SQLite/FS has none.

What we use instead:

```
.crucible/runs/<runId>/
  input.json          URL, PRD, intent, creds ref, budget
  recon.json          route map, auth outcome, detected surfaces
  specs/*.md          Planner output — the human-readable test plan
  critique.json       Coverage Critic verdict + gap list
  tests/
    seed.spec.ts      auth/state bootstrap (Playwright convention)
    <flow>/<case>.spec.ts
  playwright.config.ts
  results/            results.json, junit.xml, traces/, videos/, screenshots/
  heal/               patch-<test>-<n>.diff  (before/after, assertion diff)
  report.json         final structured report
  events.ndjson       ← append-only decision log; source of truth
```

`events.ndjson` is the whole database. The run's state is a left-fold over it. This gives us,
for free: SSE replay, crash recovery, time-travel scrubbing in the UI, and — critically —
**offline demo replay** (§7).

*Add Supabase only if* we decide to ship shareable hosted report links after the demo works.
That is a Phase 8 nice-to-have, behind a `StorageAdapter` interface so it is a drop-in.

---

## 3. The four judgment components (this is where we win)

Everything below is orchestrator-owned. This is the answer to "how intelligently does the
orchestrator handle coverage gaps, ambiguity, and failure classification?"

### 3.1 Coverage Critic — the gate between PLAN and GENERATE

Required by the brief ("Evaluate the generated plan for coverage gaps *before* passing it to the
Generator"). Input: the plan + recon evidence + PRD (if given) + intent. Scores against a fixed
rubric so the number means something run-to-run:

| Dimension | What it checks |
|---|---|
| Flow completeness | Are the app's discovered surfaces each represented? |
| Negative paths | Invalid input, wrong credentials, permission denial |
| Error states | 4xx/5xx handling, empty states, network failure |
| Edge cases | Boundary values, unicode, max length, duplicate submit |
| State variants | Logged-out vs in, roles, first-run vs populated |
| Destructive/idempotency | Delete, re-submit, back-button, double-click |

Returns `{ scores, gaps: Gap[], verdict: "pass" | "replan", rationale }`.
On `replan`, the gaps are fed back to the Planner as **targeted directives** (not "try again") —
and we cap replans at `maxReplans` (default 2) so it terminates. Every loop is logged with its
before/after score, which is a great thing to show on stage: *"the orchestrator rejected its own
plan and improved coverage from 61 → 88."*

### 3.2 Live selector validation — the gate inside GENERATE

The Generator may not write a locator it has not resolved against the live page via Playwright
MCP in the same turn. If a locator can't be resolved, the scenario is **quarantined with a
reason**, not emitted as a guess.

This exists to prevent the classic demo disaster: 40 generated tests, 38 red. We would rather
ship 12 green tests and an honest "8 scenarios quarantined, here's why" than 40 red ones.
That honesty *is* the product.

### 3.3 Defect Classifier — the gate between EXECUTE and HEAL

The brief's hardest ask, and a Bonus item. On failure we assemble an **evidence bundle**:

- error class + message + stack, failing step index
- a11y snapshot at failure vs. the snapshot captured at generation time (diff!)
- console errors, network log (any 5xx?), HTTP status of the last navigation
- screenshot + trace path
- did this exact locator resolve at generation time? (we recorded it — §3.2)
- do other tests touching the same element also fail? (cross-test correlation)
- did the app's build/commit change? (n/a for a URL target, but recorded)

Classified into four buckets with confidence + cited evidence:

| Verdict | Signal | Orchestrator action |
|---|---|---|
| `SCRIPT_DRIFT` | locator missed, but an equivalent element exists in the snapshot | → Healer |
| `APP_DEFECT` | 5xx, uncaught JS exception, business assertion violated while UI is healthy | → **Bug ledger. Do NOT heal.** Test stays red. |
| `ENV_FLAKE` | timeout, connection reset, non-deterministic wait | → retry once, then reclassify |
| `PLAN_ERROR` | the scenario assumed a feature that does not exist | → planner backlog, quarantine scenario |

> **The line to say on stage:** *"Healing a genuine bug is the cardinal sin of self-healing tests —
> you delete the signal you built the suite to produce. So our healer is not allowed to run until
> the classifier says the app is fine and the script is wrong."*

### 3.4 Assertion-integrity guard — the gate inside HEAL

Novel, cheap, and a strong talking point. The Healer may rewrite **locators and waits**. It may
**not weaken assertions**. After each patch we diff the assertion set (count, subject, matcher,
expected value); if an assertion was deleted, loosened (`toHaveText` → `toBeVisible`), or had its
expected value changed, the patch is **rejected** and the test escalates to quarantine.

Plus budgets: ≤2 heal attempts per test, ≤N per run, and non-convergence → escalate with a
human-readable note. That is the brief's "when to escalate," made concrete.

### 3.5 Risk Ledger — what we did *not* test

The brief asks for "untested flow risk" and nobody else will do it well. Every discovered-but-
untested surface gets scored on: auth-gated?, destructive?, payment/PII touching?, reachable in
≤2 clicks from landing?, mentioned in the PRD?. Ranked list in the report:
*"Password reset — HIGH risk, untested: reachable from login, touches credentials, named in PRD §4."*

---

## 4. Sub-agent contracts

All three are `AgentDefinition`s in the Agent SDK, sharing the Playwright MCP server. Each gets a
narrow tool allowlist — a generator that can `rm -rf` is a liability.

| Agent | Tools | In | Out |
|---|---|---|---|
| **Recon** (ours, pre-Planner) | Playwright MCP nav/snapshot | URL, creds | `recon.json`: route map, auth result, interactive-surface digest, detected app archetype |
| **Planner** | Playwright MCP (read-only browsing), Write | recon, PRD, intent, critic directives | `specs/*.md` — human-readable numbered scenarios w/ steps + expected results |
| **Generator** | Playwright MCP (incl. `browser_generate_locator`, `browser_verify_element_visible`), Read/Write | one spec file | `tests/**/*.spec.ts` + `selector-provenance.json` (which locator was verified when) |
| **Healer** | Playwright MCP, Read/Edit, Bash (`npx playwright test <file>` only) | failing test + evidence bundle | patch diff + rerun result, or escalation |

**Recon is our own addition** and it matters: it's what makes the whole thing work from a bare
URL with no seed test. It logs in if creds are given, crawls breadth-first to a depth cap,
compacts each page to an interactive-element digest (the Hercules lesson — never raw HTML), and
writes `seed.spec.ts` so the Planner explores as an authenticated user.

### Model assignment

Default every agent to OpenAI's strongest reasoning model; reasoning effort is the cost dial:

| Component | Model | Effort | Why |
|---|---|---|---|
| Orchestrator / Critic / Classifier | frontier reasoning | `high` | These are the judgment calls — the whole thesis |
| Planner | frontier reasoning | `high` | Open-ended exploration |
| Generator | frontier reasoning | `high` | Generated-code quality is 20% of the score |
| Healer | frontier reasoning | `high` | Long agentic loop |
| Recon crawl summarisation | small/fast tier | `low` | High volume, low judgment |

Exact model ids are pinned in one place (`src/server/agents/models.ts`) and exposed per-agent in
Settings, so we can downshift a tier if we're burning credits during dev. The Agents SDK has no
`maxBudgetUsd`, so the orchestrator enforces the budget itself from streamed `usage` — that guard
already exists and already trips (see §6, Phase 2).

**Pinned in Phase 3.** `models.ts` now holds real ids. The table above describes the *production*
setting; the committed defaults are deliberately the cheapest tier instead — `gpt-5.6-luna`, effort
`low`/`medium` — because Phase 3 is a build-and-iterate phase and frontier-model burn on every churn
buys nothing. Reaching the table above is an environment change, not a code change:

| Variable | Effect |
|---|---|
| `ODYSSEY_MODEL` | Every agent |
| `ODYSSEY_MODEL_RECON` / `_PLANNER` / `_CRITIC` | One agent; wins over `ODYSSEY_MODEL` |
| `<any of the above>_EFFORT` | Reasoning effort: `none` … `max` |

Available ids at time of pinning: `gpt-6-astra` (strongest), `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna` (cheapest). `models.ts` carries each one's published per-token price, because a
pinned id with a stale price silently lies to the budget guard.

> **Checked against the live account** during Phase 3 verification: `gpt-5.6-luna`, `-sol` and
> `-terra` all exist and are reachable with our key. **`gpt-6-astra` is not on this account** —
> it stays in the price table but setting `ODYSSEY_MODEL=gpt-6-astra` would 404. Before the demo,
> confirm the tier you intend to run on with `GET /v1/models` rather than from this table.

---

## 5. Event model (the UI/orchestrator contract)

One discriminated union, defined once in `src/lib/types.ts`, used by orchestrator, SSE, and UI.
**Phase 1 builds the entire UI against this**, driven by a mock emitter — so Phase 2+ is a
drop-in swap with zero UI rework.

```ts
type OrchestratorEvent =
  | { type: "run.started";      runId, input, startedAt }
  | { type: "stage.entered";    stage: Stage, attempt: number }
  | { type: "stage.exited";     stage: Stage, outcome, durationMs }
  | { type: "decision";         stage, action, rationale, confidence, evidence[] }  // ★ the money event
  | { type: "agent.thinking";   agent, text }
  | { type: "agent.tool";       agent, tool, summary, ok }
  | { type: "artifact";         kind: "plan"|"test"|"trace"|"screenshot"|"video"|"patch", path, title }
  | { type: "plan.ready";       scenarios: Scenario[] }
  | { type: "critique.ready";   scores, gaps, verdict }
  | { type: "test.generated";   testId, file, scenarioId, selectorsVerified }
  | { type: "test.result";      testId, status: "passed"|"failed"|"quarantined", durationMs }
  | { type: "triage.verdict";   testId, verdict: Verdict, confidence, evidence[] }
  | { type: "heal.attempted";   testId, attempt, patch, assertionsIntact: boolean }
  | { type: "heal.result";      testId, outcome: "healed"|"escalated"|"rejected" }
  | { type: "bug.filed";        testId, title, severity, evidence[] }
  | { type: "cost";             usd, tokensIn, tokensOut }
  | { type: "run.finished";     status, report: TestQualityReport }
  | { type: "error";            stage, message, recoverable }
```

`decision` is the star of the demo. The UI renders a **Decision Log** — a vertical feed of
"the orchestrator chose X because Y (confidence 0.82), citing [evidence]." That single panel is
most of the *"how clearly does the team present the agent's decisions"* 15%.

---

## 6. Phase plan

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0** ✅ | Research + this plan + `PLAN.md` | done |
| **1** ✅ | **UI shell.** Next.js scaffold, design system, `types.ts`, launcher page, mission-control page, report page, mock event emitter driving the whole thing | `pnpm dev` → enter a URL → watch a full fake pipeline stream, end to end, looking real |
| **2** ✅ | Orchestrator FSM + real SSE + run store + workspace scaffolder. Agents still deterministic stubs | A real run row persists; UI streams from `events.ndjson`, not mocks; crash/reload resumes |
| **3** ✅ | Recon + Planner (`@openai/agents` + Playwright MCP) + Coverage Critic + replan loop | **Met against a live app.** Recon signed in unaided and crawled 11 authenticated routes; the Critic scored 62, named 7 gaps, and the revision passed at 82. See §10. |
| **4** ✅ | Generator w/ live selector validation + executor (`playwright test --reporter=json`) | **Met.** `run_7408ff5f`: 2 tests emitted at 14/14 and 20/20 proven locators, executed green — `expected: 2, unexpected: 0`. See §12. Shard parallelism was *not* built — there is no `--shard` anywhere. Parallelism is worker-based and a watched run forces `workers: 1`, so fan-out and the headed-browser invariant are in direct conflict, and watching won. |
| **5** ✅ | Triage/classifier + Healer + assertion-integrity guard + bounded re-execute | **Met by `run_8b37144b`.** A renamed control was classified SCRIPT_DRIFT and healed; a 500 was classified APP_DEFECT at 0.94, filed as a bug and left red. See §13.7. |
| **6** ◀ *now* | Report synthesis, PRD gap analysis, risk ledger, artifact viewer (trace/video/screenshot) | The report answers all six must-have bullets |
| **7** | Replay mode, demo script, README, architecture diagram, deck, video | Rehearsed 4-minute demo that cannot fail |

Phase 1 is scoped so that phases 2–6 never touch the UI layer again.

---

## 7. Demo insurance (do not skip)

1. **Replay mode.** `events.ndjson` replays at recorded pacing. A perfect run is recorded the
   night before. If the venue's wifi or the LLM API dies mid-demo, we switch to replay and keep
   talking. We *tell* the judges this exists — it's an engineering virtue, not a cheat.
2. **Bring our own target.** The brief explicitly warns not to wait for the organiser's URLs.
   Ship two: a local Next.js "ShopLite" (checkout + auth + admin, with a **feature-flagged
   deliberate bug** so we can demo `APP_DEFECT` classification on command) and a public demo app
   as a second surface to prove generality.
3. **Budget guard.** `maxBudgetUsd` per run + a visible cost meter. Nothing kills a demo like an
   agent looping for nine minutes.
4. **Time guard.** Hard wall-clock cap per stage with graceful degradation — report what we have.

---

## 8. Phase 1 build sheet (what I'm doing right now)

Scaffold: `pnpm create next-app` — TS, Tailwind v4, App Router, `src/`, alias `@/*`.

```
src/
  lib/
    types.ts            ← the full event/domain model (§5). Written once, never rewritten.
    mock-run.ts         ← scripted realistic run → OrchestratorEvent[] with delays
    format.ts           ← duration/cost/percent helpers
  hooks/
    use-run-stream.ts   ← abstracts mock-now / SSE-later behind one hook
  components/
    launcher/           url-input, prd-drop, intent-box, advanced-drawer, target-presets
    console/            stage-pipeline, decision-log, agent-activity, artifact-rail, cost-meter
    report/             score-cards, scenario-table, healer-actions, gap-list, risk-ledger
    ui/                 button, card, badge, tabs, progress, drawer, code-block
  app/
    page.tsx            launcher
    runs/[id]/page.tsx  mission control
    runs/[id]/report/page.tsx
```

**Design direction:** dark "mission control." Near-black `oklch` base, a single hot accent for
*decisions*, monospace for evidence/code, generous whitespace, everything streaming in with
motion. Stage pipeline as a horizontal rail with live state. The Decision Log is the hero panel
and gets the most visual weight — because the decisions *are* the product.

Accessibility + responsive from the start; judges will watch on a projector at odd aspect ratios.

---

## 9. Open questions to resolve before Phase 3

- [x] Do we run Playwright MCP as one long-lived server per run (`--port`, HTTP) or stdio per
      sub-agent? **Resolved in Phase 3: stdio, one server per agent invocation, `--isolated`.** The
      hunch above was half right — `--isolated` is correct, but a server per *run* was not, because
      the tool allowlist is per-agent and a shared server cannot hold two different ones. Recon
      writes `results/state.json` via the seed spec, so auth state carries forward as a file rather
      than as a live process, which also survives a resume.
- [x] Credential handling: env-var reference vs. encrypted-at-rest in `input.json`. Never log them —
      add a redaction pass on the event writer *before* Phase 3. **Resolved:** the redaction pass
      exists and Phase 3 routes every agent prompt and tool summary through it. Target credentials
      stay out of `input.json` entirely; the provider key is read only in
      `src/server/agents/openai.ts`, is added to the redaction set, and the Playwright child process
      is spawned with a deliberately minimal env so it never sees it.
- [ ] Parallel execution: Playwright `--shard` (simple) vs. our own worker pool (more control over
      per-flow isolation). Start with `--shard`, `fullyParallel: true`.
- [ ] PRD ingestion: PDF parsing needed, or paste-as-markdown only for the demo? Start with paste
      + `.md`/`.txt` upload; add PDF only if time remains.

---

## 10. Phase 3 verification — what a live run actually showed

Phase 3 was marked done in §6 while it had never been executed against a live key. It was then
run against a real authenticated SaaS target (`app.docxion.com`, credentialed) on a real model.
This section is the record, because "the code exists" and "a run produced it" are different
claims and this project had been conflating them.

### It works

| | Result |
|---|---|
| Recon | Found the login form unaided, signed in, entered a workspace, crawled **11 routes** breadth-first, `authenticated: true`. ~180s. |
| Planner | 6–8 scenarios from Recon's map. |
| Critic | **62 → 82, verdict `pass`** across one re-plan. Also observed 66 → 77, and 68 → 72 (below threshold, proceeded on spent allowance). |
| Orchestrator | Coverage gate, budget guard, redaction, event log, resume — all behaved. No human between stages. |
| Cost | ≈**$0.06** per full run at the `luna` tier. |

The re-plan loop is the product thesis and it holds up on a target nobody had seen before.

### Four defects it exposed — all fixed, merged in `207e7c2`

1. **Headed browsing was a default, not a guarantee.** `headless` was a field on `RunOptions` and
   the API parser accepted it from any request body. Now an invariant in `server/browser-mode.ts`
   with one process-wide escape hatch (`ODYSSEY_HEADLESS`) for machines with no display. The
   generated `playwright.config.ts` is headed too, which forces `workers: 1` — a watched suite and
   a parallel suite are in direct conflict, and watching won.

2. **The auth hand-off did not exist.** `playwright-mcp.ts` claimed Recon's session reached the
   Planner as `results/state.json`. Four links were missing: the seed spec never logged in, nothing
   executed it, the file was absent from every workspace on disk, and the Planner's browser was
   never pointed at it. Nothing *failed*, because the Planner plans from Recon's map and never
   opens a browser — but the Generator cannot do that, and would have quarantined the entire Phase
   4 suite. Fixed with a shared per-run profile (`--user-data-dir`) replacing `--isolated`;
   `--storage-state` only *loads* state and cannot do this job. Verified by reading
   `access_token` / `refresh_token` out of the profile on disk after Recon.

3. **There was no Playwright test runner.** `@playwright/test` and `playwright` were both
   unresolvable — transitive deps of `@playwright/mcp` that pnpm's strict layout hides. The trap:
   `npx playwright --version` answered anyway, `1.62.0`, from `/opt/miniconda3/bin/playwright`. An
   executor shelling out to `npx playwright test` would have worked on one machine and failed on
   every other. Now a pinned devDependency matching MCP's version, browser installed, headed launch
   verified. **Phase 4's executor must invoke `node_modules/.bin/playwright`, never bare `npx`.**

4. **The run displayed numbers nobody measured.** The cost meter read $1.26 of which $1.20 was
   fabricated by stubs calling `ctx.spend` with hardcoded figures — 95% fiction, and the budget
   guard was gating on it. The report called an empty suite *"every executed test is green"*. The
   execute stage narrated a sharding rationale citing evidence nothing collects. The bug ledger
   preferred a hand-written record out of `fixtures.ts` whenever a `testId` matched.

Plus: the scenario budget made the Critic **structurally unable to pass**. The Planner filled the
cap on pass 1, so a revision had no free slot and could close a gap only by deleting coverage —
which the Critic scores as a fresh gap. First pass now takes 75% of the cap; the user's cap stays
absolute.

---

## 11. Open items for Phase 4 — closed

Every blocking and credibility item below was closed during Phase 4. They are kept, struck
through, because what each one *was* is the fastest way to understand why the code that
replaced it is shaped the way it is.

### Blocking — all done

- [x] **`playwright test` has no session.** Done, and by the recommended route:
      `agents/storage-state.ts` dumps the shared profile after Recon. One correction to the
      recommendation — the dump goes through the MCP's own `browser_storage_state` rather than our
      own `launchPersistentContext`, because the MCP launches real Chrome (channel `chrome`) and a
      second launcher would risk version skew against the profile on disk. The localStorage warning
      was well placed: the clinic target carries **0 cookies and 4 localStorage entries**, so a
      cookies-only check would have passed while handing the suite nothing.
- [x] **`GENERATOR_TOOLS` allowlist.** Done, positive, with `browser_evaluate` and
      `browser_run_code_unsafe` excluded as required. `browser_storage_state` is deliberately *not*
      in it — the hand-off calls it via `server.callTool()`, which bypasses `toolFilter`.
- [x] **The real seed.** Superseded rather than done: there is no seed spec. The session reaches
      the suite as `storageState`, which is what the seed was a worse way of achieving.

### Credibility — all done

- [x] **The confidence badges are fake.** `decision.confidence` is now optional and the badge
      renders only where something computed it. Eleven hardcoded literals are gone; the one that
      remains is the triage verdict, which really does compute `Math.min` of the classifier's
      per-failure confidences.
- [x] **A zero-test run still reports `succeeded`.** Now reports `failed`, with an `error` event
      saying why.
- [x] **Redaction ran after truncation.** Now redacts first, then truncates
      (`agents/harness.ts`). Truncation also keeps the **tail** as well as the head: Playwright
      puts the cause of an actionability failure on the *last* line of the call log, so head-only
      truncation was discarding precisely the diagnostic.

### Tuning

- [ ] **`maxReplans: 1` is the binding constraint**, not the scenario cap. Still true, with one
      data point against it: on `playwright.dev` the first pass scored **82** and was accepted with
      `maxReplans: 0`. The 62–68 range was measured on the clinic app, which is a harder target.
      **Run the demo at `maxReplans: 2`** remains the advice.

### ~~Not started, and not in any phase~~ — built in Phase 5

- [x] **The demo target with the feature-flagged deliberate bug.** Built: **ShopLite**, at
      `/shoplite`, with two switches on `/shoplite/control` (§13.3). It stopped being a nice-to-have
      the moment the Healer became real, because Phase 5's exit criterion is a sentence about an
      application that can be broken on command and there was no such application.

---

## 12. Phase 4 verification — what live runs actually showed

Phase 4 is implemented and exercised end to end by real runs against real targets. The Generator
emits tests whose every locator was resolved on the live page; the Executor runs them with the
project's own Playwright and reports what the runner said.

### The closing run — `run_7408ff5f`, against `https://playwright.dev/`

**A full orchestrated run produced a green suite.** This is the claim the phase turns on, and it
was the last one outstanding.

| | |
|---|---|
| Scenarios planned | 2, critique **82 on the first pass**, accepted with `maxReplans: 0` |
| Tests emitted | 2 — locator provenance **14/14** and **20/20** |
| Executed | `expected: 2, unexpected: 0, flaky: 0` in Playwright's own `results.json` |
| Run status | `succeeded` |
| Cost | **$0.317** |

Two details worth keeping, because both are load-bearing evidence rather than colour:

- The report's `config.rootDir` was `<workspace>/tests`, not the workspace — the exact shape of
  the defect in §12.1 below. Both tests matched anyway, which is that fix working in production.
- The target is **read-only**, chosen deliberately: it is the one condition under which the
  storage-state hand-off cannot carry the agents' own side effects into the suite (see the open
  design finding below). It closes "can this pipeline produce green?" without pretending to close
  the design question.

### 12.1 Four defects the earlier runs exposed — all fixed

Each was invisible to typechecking and to reading, and each was found by running the thing.

1. **A wedged scenario killed the whole run.** `Max turns exceeded` on scenario 4 of 10 threw out
   of the loop, discarding the nine after it, the one test already emitted, and the provenance
   record. Now caught per scenario, which quarantines with the error as its reason and carries on.
   Aborts still propagate, so a cancelled run is not reported as ten quarantines.
2. **The Executor matched no test to its own report.** Playwright sets `config.rootDir` to the
   common ancestor of the collected specs — the `tests/` directory — so the report named a file
   `foo.spec.ts` while the run recorded `tests/foo.spec.ts`. Since an unmatched generated test is
   reported as a failure, **a suite that passed every test would have reported as a suite that
   failed every test.** Both sides now resolve against their own root and re-relativise.
3. **`budgetUsd` did not gate the stage that spends the money.** It gated re-planning and healing
   while `generate` — 86% of the bill — ignored it. `AgentContext.overBudget()` now exists and the
   Generator stops between scenarios, holding the unrun ones as reported rather than silently
   missing. Note the ceiling is enforced *between* scenarios, so a run overshoots by up to one
   scenario: `run_7408ff5f` finished at $0.317 against a $0.30 ceiling.
4. **Run artifacts leaked into the repo root.** The HTML reporter had no `outputFolder`, so it
   wrote `playwright-report/` beside the *project's* package.json. Both reporters are now pinned
   inside the run workspace.

### 12.2 The viewport skew, closed

Generation browses at 900×620 on a watched run; the emitted suite ran at `devices["Desktop
Chrome"]`, which pins 1280×720. Every locator was therefore proven at one width and asserted at
another — and a responsive app is a different app at a different width. The generated config now
pins the project's viewport to the window the Generator browsed at.

It has to be set inside the **project's** `use`: that is merged *over* the top-level one, so
`devices["Desktop Chrome"]` was reimposing 1280×720 whatever the top level said. Only the watched
path is pinned; under `ODYSSEY_HEADLESS=1` no `--viewport-size` reaches the MCP either, so that
case is left as it was rather than pinned to an unmeasured number.

This is also what makes the three *"another navigation button intercepted pointer events"*
failures on `app.docxion.com` answerable: with the skew gone, a failure that survives it is the
app's.

### 12.3 Still open — a design finding, not a defect

**The storage-state hand-off carries the agents' own side effects into the suite.** On TodoMVC,
Recon created a todo while crawling, `captureStorageState` dumped it, the suite started with that
todo already present, and the generated test died on a strict-mode violation. On a credentialed
app this is mostly benign — the session is the point — but any record the agents create becomes
suite fixture data. Relatedly, scenarios share one browser session during generation by design
(that is how the login survives), so scenario 1's data is visible to scenario 2.

Both are architecture decisions and are deliberately unchanged. `run_7408ff5f` routes around them
with a read-only target; it does not resolve them.

### 12.4 Tests

`pnpm test` — Node's runner, 19 assertions, ~0.4s, no API and no browser.

- `agents/locator-provenance.test.mts` — the provenance gate, against a ledger of Playwright MCP
  replies copied verbatim from a live session. The rejection cases are the ones that matter: if a
  change makes a previously-rejected locator pass, the change is wrong.
- `agents/report-keys.test.mts` — the report-to-generated-test match, pinned against a real
  unedited Playwright JSON report in `agents/__fixtures__/`. This is the regression test for
  defect 2 above.

`specsIn`, `keyOf` and the report types live in `agents/report-keys.ts` rather than inside
`executor.ts` for exactly one reason: `executor.ts` cannot be loaded outside Next, so a test of it
could only ever be a *copy* of it. The copy is what the previous version of this test was, with a
comment admitting it could drift.

---

## 13. Phase 5 — Triage, the Healer, and a target that can be broken on command

**Status: done, and proven by an orchestrated run** — `run_8b37144b`, §13.7. That run also
exposed two defects and one architectural mismatch that no amount of reading had, which is the
fourth phase in a row where that has been true.

`triage`, `proposeHeal` and `rerun` are real in `agents/index.ts` and reachable through
`ODYSSEY_REAL_AGENTS`. The FSM around them did not change shape: it already routed
`APP_DEFECT` away from the Healer and ran the assertion guard on every patch. What changed is
that the three things it was routing are no longer deterministic stand-ins.

### 13.1 The classifier is two layers, and the seam is the point

Defect classification is the brief's Bonus item and the easiest thing in this project to fake: a
model handed an error string will answer "script" or "app" fluently, and nothing about the answer
is checkable. So the verdict is produced in two layers that can disagree in public.

**The prior** (`agents/failure-signals.ts`) is a rule table over two inputs neither the model nor
anyone else can argue with: Playwright's own error text, and the generation-time locator ledger.
The error text already contains most of the classification — *the element was never found* and
*the element was found and held the wrong value* are different verdicts and Playwright says which
happened. The ledger supplies the other half: a locator that Playwright itself handed us twenty
minutes ago and cannot find now is drift; one that never resolved was never evidence. The prior is
reproducible, costs nothing, and is deliberately capped below 0.75 — it has read a string, not
looked at an application. A unit test pins that cap.

**The live pass** gives the classifier a read-only browser (`CLASSIFIER_TOOLS` — no click, no
type) and the two tools that see what the error text cannot: `browser_console_messages` and
`browser_network_requests`. It may overturn the prior; it may not do so quietly. `agreesWithPrior`
is part of its structured output, an overruling that cites live evidence keeps most of its
confidence, and **an overruling that cites nothing is damped to ≤0.45 and says so in its own
rationale**. That damping is the honest version of "the model disagreed", and it is visible in the
Decision Log rather than folded into a number.

Bug titles now come from the classifier that found the defect rather than from a template. The
orchestrator files what was diagnosed; inventing a description of a bug nothing diagnosed was the
`fixtures.ts` failure mode of Phase 3, in a new costume.

### 13.2 The Healer is held to the Generator's rule

Three constraints, all enforced outside the model:

1. **The assertion-integrity guard** (unchanged, `orchestrator/assertion-guard.ts`) — syntactic,
   so it cannot be argued out of.
2. **Locator provenance, applied to the patch.** Every locator the patch *introduces* must have
   been resolved on the live page during the healing session, checked by the same `prove()` the
   Generator's gate uses. Locators the file already carried are exempt: they were proven when the
   test was written, and re-proving them would spend a browser walk re-deriving the record. A
   healer allowed to guess is a slower way of writing a red test.
3. **Bounded attempts**, with a decline treated as a result. "The Healer proposed no patch" and
   "three patches did not converge" are different escalations and the Decision Log now says which.

An `ENV_FLAKE` is **retried before it is patched**. A retry costs one test run and settles the
question; patching a test that was only ever slow bakes a workaround into the suite for a problem
that does not exist.

Applying an accepted patch is the *orchestrator's* act, not the Healer's — the Healer returns
before/after, the guard clears it, and `run.ts` writes the file and the diff. The diff is computed
from the same before/after that was checked (`orchestrator/patch.ts`), so the artifact and the
file that will actually run cannot disagree.

### 13.3 ShopLite — the target the exit criterion needs

Phase 5's exit criterion is a sentence about an application that can be broken on command, and
until now there was no such application. **ShopLite** is one: `/shoplite`, four products, a
session cookie, a basket, checkout and order history. Two switches on `/shoplite/control`, held in
a file so they survive a dev-server reload and can be flipped *between two stages of a live run*:

| Switch | What breaks | Correct verdict |
|---|---|---|
| `drift` | "Add to cart" becomes "Add to bag" — the accessible name, which is what `getByRole` matches | `SCRIPT_DRIFT` → heal |
| `defect` | `GET /api/shoplite/orders` answers 500; the order is still placed, the history cannot render | `APP_DEFECT` → file a bug, withhold the Healer |

Both are diagnosable by a browser that only *looks*: the renamed control is in the accessibility
snapshot, and the 500 is in the network log and the console of a plain page load. That is not a
coincidence — the classifier is read-only by allowlist, so a defect reachable only by clicking
would be a defect it could not classify.

One deliberate design choice: **the basket lives in `sessionStorage`, the session in a cookie.**
Playwright's `storageState` carries cookies and `localStorage` and not `sessionStorage`, so the
generated suite inherits the login and *not* the shopping the Generator did while proving
locators. That is a concrete answer to §12.3 — not a fix for the general case, but an example of
an application that does not have the problem, which is worth being able to point at on stage.

Verified in a real browser, not by reading: sign-in rejects a bad password with the message the
page renders, the basket totals £84.00 for 2 × £42.00, the order appears in history by id, a fresh
context built from the captured `storageState` is signed in with an **empty** basket, and each
switch produces exactly the failure shape it promises.

### 13.4 The run that closed the phase

```bash
pnpm dev --port 3002
# 1. Healthy ShopLite. Let the pipeline plan, generate and execute green.
curl -sS -X POST localhost:3002/api/runs -H 'content-type: application/json' -d '{
 "url":"http://localhost:3002/shoplite",
 "credentials":{"username":"ada@shoplite.test","password":"lovelace"},
 "options":{"maxScenarios":3,"maxReplans":1,"budgetUsd":0.60}
}'
# 2. Then, on a second run, break it first and watch what the classifier does:
curl -sS -X POST localhost:3002/api/shoplite/flags -H 'content-type: application/json' \
  -d '{"drift":true}'    # expect SCRIPT_DRIFT → heal
curl -sS -X POST localhost:3002/api/shoplite/flags -H 'content-type: application/json' \
  -d '{"defect":true}'   # expect APP_DEFECT → bug filed, Healer withheld
```

### 13.5 Tests

`pnpm test` — 40 assertions, ~0.5s, no API and no browser. New in this phase:

- `agents/failure-signals.test.mts` — the prior. Every Playwright error shape gets a case, because
  a parse that stops recognising one silently turns a confident verdict into the weak fallback.
  The case that matters most is an assertion failure on a *proven* locator: that is the one that
  says `APP_DEFECT`, and `APP_DEFECT` is the verdict that files a bug and withholds the Healer.
  One test asserts the property rather than an example — **no prior, for any input, claims more
  than 0.75.**
- `orchestrator/patch.test.mts` — the heal diff, which is the artifact a person reviews a heal by.
  A diff that drops or invents a changed line would let a patch read as something it is not.

### 13.6 What the closing run showed — `run_8b37144b`

Against a local ShopLite, three scenarios, both switches flipped **between GENERATE and EXECUTE**
so the suite was written against a healthy application and run against a broken one. That is the
situation a real team is in every morning, and it is the only way to test the classifier honestly:
generate against a broken app and there is nothing to misclassify.

| | |
|---|---|
| Plan | critique **72 → 80** after one re-plan, accepted |
| Generated | **3 tests, 0 quarantined** — provenance 5/5, 24/24, 5/5 |
| Executed | 3 failed, which was the point |
| Classified | `APP_DEFECT` 0.94 · `SCRIPT_DRIFT` 0.61 · `ENV_FLAKE` 0.70 |
| Healed | 1 (the drift), 1 escalated by the assertion guard, 1 left red as a filed bug |
| Cost | **$0.161** |

**The classifier got all three right, and the two layers earned their keep on two of them.**

- *The 500.* Prior: `APP_DEFECT` from an assertion failure on a locator proven at generation time.
  The live pass agreed and raised it to **0.94**, citing the 500 and the console line, and wrote
  the bug title itself: *"Authenticated order history fails with exhausted connection pool."* The
  Healer was withheld and the test stayed red — the outcome the whole design exists to produce.
- *The renamed control.* Prior: `ENV_FLAKE` at 0.4, because the runner reported a bare 90-second
  test timeout and named no locator — the rules had nothing to work with. The live pass overturned
  it to `SCRIPT_DRIFT`, citing what it saw: *"the product controls are labeled 'Add to bag'."*
  That is the seam working in the direction it was built for: a weak prior, overturned on a live
  observation, published as an `overrule_prior` event rather than a silent swing.
- *The flake.* Retried once before any patch, per §13.2. It reproduced, so it was not a flake and
  fell through to the Healer — which is the fallthrough working, not a misprediction being papered
  over.

**The assertion-integrity guard rejected a real patch, unprompted.** On its second attempt at the
sign-in test the Healer summarised its own work as *"extended timeouts … without changing any
assertions"* and the syntactic diff found that it had. Patch rejected, test escalated. The guard
has existed since Phase 2 and this is the first time anything has actually tried to get past it.

**The heal that worked** is one line, and it is the whole pitch in a diff:

```diff
-  await page.getByRole("link", { name: "Basket" }).click();
+  await page.getByRole("link", { name: "Bag" }).click();
```

`getByRole("link", { name: "Bag" })` was resolved on the live page during the heal — the Healer is
held to the Generator's rule and the run recorded *"all 1 new locator(s) in the patch were resolved
on the live page"*. Every assertion in the file is untouched. The re-run went green and the test is
reported `healed`, which is a different fact from `passed` and counted separately.

### 13.7 Three things the run found that reading had not

1. **The auth hand-off was racing Chrome's disk flush.** *(Fixed.)* The session passed from Recon
   to the later agents through the shared `--user-data-dir`, and **Chrome writes its cookie store
   to disk lazily**. `run_1ad8602e` won that race; `run_0c3d41d1`, on identical code, lost it —
   Recon reported an authenticated crawl of four routes and the Generator, two stages later,
   quarantined all three scenarios because it could not sign in. The symptom points at the target,
   the cause was ours, and on a cookie-only application it was a coin flip every run.

   The hand-off is now explicit: Recon dumps the session to `results/state.json` **while its own
   browser is still open**, and every agent after it runs `--isolated --storage-state <that file>`.
   A capture that comes back empty no longer overwrites a good one. The profile remains the path
   for Recon and the fallback for an anonymous run. `run_8b37144b` shows the fix working —
   *"results/state.json — 1 cookie(s)"* at the end of recon, and the Generator opening signed in.

   This also retires the note in `playwright-mcp.ts` about concurrent agents needing "a profile per
   agent plus an explicit state hand-off". That is now what this is.

2. **An accepted patch was reported as a healed test.** *(Fixed.)* `HealAttempt.outcome` was set to
   `"healed"` the moment the assertion guard passed, before the re-run had said anything. The
   sign-in test's first attempt is in the report as `healed` while the test was still red. The
   outcome is now provisional until the re-run answers.

3. **A signed-out scenario cannot be tested by a suite that ships a signed-in session.**
   *(Addressed in the Generator's prompt; not yet re-verified by a run.)* The Generator signed out
   to prove the rejected-credentials flow and wrote a test asserting that `/shoplite/products`
   shows the sign-in heading. The suite runs with the captured `storageState`, so it is signed in,
   the products page renders products, and the test fails on every assertion — for a reason that
   is neither the script's fault nor the application's. The classifier called it `ENV_FLAKE` at
   0.70, which is wrong in an interesting way: it navigated to the page, saw the heading, and had
   no way to know the suite would arrive holding a session it did not.

   The Generator is now told that a scenario about signed-out behaviour must drop the session for
   itself with `test.use({ storageState: { cookies: [], origins: [] } })`. The deeper point is
   worth keeping: **state variance is a first-class property of a test suite**, and one captured
   session per run is an assumption the Planner is free to violate — it was told to cover
   state-variants and it did exactly that.

---

## 14. Phase 6 — the final report, the risk ledger, and PRD traceability

**Status: built, unit-pinned, and not yet through a live run with real agents.** That last clause
is deliberate and it is the one thing this phase owes. Every prior phase in this repo was marked
done once before it had ever run, and running it found defects each time; the honest label until a
real run exists is "built".

Phase 6 closes the brief's **last unclosed Must Have** — *"produce a final test quality report:
scenarios covered, pass/fail outcomes, healer actions taken, coverage gaps remaining, and untested
flow risk"* — and its **first Bonus item**, *"PRD-to-test-plan gap analysis"*. `assessRisk` and
`tracePrd` are real in `agents/index.ts`. Nothing on the `Agents` interface is a stand-in any more.

### 14.1 Coverage is measured off the suite, not off the plan

The tempting build for "untested flow risk" is to ask a model which routes the plan missed. The
answer reads well, costs a call, and is unfalsifiable. `agents/coverage-map.ts` computes it instead
from two things already on disk:

1. **The emitted test source.** A test that navigates to `/orders` contains `"/orders"` in a file
   this run wrote. Matching is bounded on both sides — unbounded, `/order` claims `/orders` and `/`
   claims every URL in the file — and a query string or a fragment still counts as a visit.
2. **Whether that test ran.** A scenario is an intention; a scenario the Generator quarantined
   produced no evidence about the application at all.

Which yields three states rather than a boolean, and the middle one is the finding:

| State | Meaning |
|---|---|
| `exercised` | A test that ran reached it. Green or red, there is evidence. |
| `planned-only` | The plan covers it and no test ran. **Intent without evidence.** |
| `untested` | Nothing in the plan named it. |

Each row also carries the *signal* behind its attribution — `navigation`, `control`,
`scenario-text`, `none` — so a weak attribution renders as a weak one. A surface covered only by
the plan's own wording says so in the report, in those words.

**The bug this found in its own first run.** `readSources` originally rebuilt the spec filename
from the scenario id, mirroring `generator.ts`'s slug rule. That worked for the real Generator's
flat `tests/<slug>.spec.ts` and missed every nested path — so the navigation signal vanished
entirely and the ledger reported every surface as untested, without erroring and while looking
completely normal. It now reads `GeneratedTest.file`, the path the Generator actually wrote. That
is the **third** time in this repo a key has been reconstructed instead of carried
(§12.1 `report-keys`, §14.2 below); each one failed the same silent way.

### 14.2 The scenario-to-result join, which was broken in the report the brief asks for

The report's "Scenarios covered" table looked its results up by `t-${scenario.id}` — a shape only
`fixtures.ts` ever produced. The real Generator sets `GeneratedTest.id` to the scenario's own id,
so **on every live run that lookup missed every row and the table rendered a fully executed suite
as `pending` from top to bottom.** In the one table the brief's final-report requirement names
first.

Fixed as `lib/report-join.ts`: one matcher, tolerant of all three conventions because saved runs on
disk carry whichever was current when they ran, pinned by `report-join.test.mts`.

### 14.3 The risk ledger is arithmetic first

`agents/risk-signals.ts` is a published weight table over a path, the PRD text and the unclosed
critic gaps. Every factor that fires contributes its weight *and writes its own sentence*, so the
report never has to narrate a number:

| Factor | Weight |
|---|---|
| `credentials` | 22 |
| `payments-pii` | 20 |
| `destructive` | 18 |
| `prd-named` | 18 |
| `quarantined` | 18 |
| `shallow` | 12 |
| `named-in-gap` | 10 |
| `session-gated` | 8 |

The bands are **calibrated against §3.5's own worked example** rather than chosen as round
numbers: *"Password reset — HIGH risk: reachable from login, touches credentials, named in PRD
§4"* is credentials + shallow + prd-named = 52, and it has to come out `high`. The same surface
with a quarantined scenario behind it reaches 70 and tips to `critical`, which is the right order.
`risk-signals.test.mts` pins that sentence, so a weight edit that stops matching the product's
description of its own ledger fails the suite.

Then the model, in `agents/risk.ts`, over the whole ledger at once — ranking is comparative. It may
do exactly two things, and both are gated:

- **Adjust a score by ±15.** There is no browser in this stage, so there is nothing new to have
  seen: an adjustment is a *reading* of facts already on the page. One whose justification names
  nothing is **discarded outright** — not damped, as triage damps an unevidenced overrule, because
  triage's model went and looked and this one did not. The computed score stands and the run says
  it dropped the adjustment.
- **Add a surface with no URL** — a modal, a cross-origin payment iframe, an outbound email step.
  It must cite a Recon observation **by index**, checked against the array. An uncited row is
  dropped, on the same principle as the Generator's locator gate: an invented HIGH-risk surface is
  worse than a missing one.

Because none of the scoring needs a model, `stubAgents.assessRisk` computes the **real** ledger
offline. There used to be a `RISKS` fixture — five hand-written sentences about an application
nobody had looked at, printing *"Payment provider iframe — card entry, 84/100"* under a run
against TodoMVC. Deleted. A fixture is only honest where the alternative costs a model call.

### 14.4 PRD traceability, and the two ways it lies

The Bonus item, and the easiest thing here to produce a convincing fake of. A model maps
requirements to scenarios and `agents/prd-gate.ts` decides what that mapping is worth.

**Invented scenario ids are struck out and counted.** A citation naming a scenario the plan does
not contain is a false claim, not a weak one, and it lands on exactly the requirement most likely
to be uncovered. The count is surfaced: an extraction that invented three references is telling you
how much to trust the other forty.

**A plan is not evidence.** This is the one worth the slide. Coverage resolves through the run's
own results into four states — `proven`, `exercised`, `planned-only`, `uncovered` — and `covered`
is true only for the first two. The naive version ticks a requirement whose only scenario the
Generator quarantined, and tells a team their PRD is covered about a flow nothing ever loaded.

Every requirement carries a **verbatim quote** from the document, which is the cheapest possible
defence against a confident extraction of requirements the PRD does not contain: a reader checks a
row in seconds instead of trusting it.

The same gate runs on the stub path. Returning `fx.PRD_TRACE` verbatim printed *"✅ proven"* beside
a requirement whose only test had **failed** — the single claim this table exists to make
impossible — and that was visible in the offline demo before anything corrected it.

### 14.5 `report.md`, and serving the evidence

The report is now written twice: `report.json` for the UI and anything mechanical, and `report.md`
beside the suite it describes — a document a team opens a pull request with, which is what the
submission's "working prototype a team could adopt" actually means.

`GET /api/runs/:id/artifacts/*` serves the files the report cites, so a screenshot of the page at
the moment a test died renders in the report instead of appearing as a path on a disk the reader
does not have. A run workspace is not a public directory, so access clears four independent checks:
the run id pattern, `path.resolve` containment, an extension allowlist, and a second containment
check on the **realpath** — because `path.resolve` collapses `..` and knows nothing about symlinks
while `stat` follows them. `results/state.json` and `browser-profile/` are denied outright ahead of
all of it: that file is a live session for the application under test.

Verified by probe: `../../../`, percent-encoded traversal, a null byte, a symlink to `/etc/hosts`
and the storage state all refused; `report.md`, `coverage.json` and the emitted specs all served.

### 14.6 Tests

`pnpm test` — **101 assertions**, up from 40, ~0.5s, no API and no browser. New in this phase:

- `lib/report-join.test.mts` — the join above, including that the last result wins so a heal's
  re-run beats the failure it replaced.
- `agents/coverage-map.test.mts` — that a prefix is not a match, that a quarantined scenario leaves
  its route `planned-only` and never covered, and that a red test still counts as evidence.
- `agents/risk-signals.test.mts` — the weight table, the bands against §3.5's example, and one
  property rather than an example: **every factor that fires carries a sentence**, and the score is
  always the sum of the weights that produced it.
- `agents/prd-gate.test.mts` — the invented-id strike-out and the four-state resolution.
- `report-markdown.test.mts` — every sentence the document must not say, plus that a pipe in a
  scenario title is escaped so it cannot silently eat a table column.

### 14.7 What this phase still owes

A live run. `computeLedger` and `gateTrace` are exercised on every stubbed run, but the model half
of both stages — the ±15 review with its discard gate, and requirement extraction with its verbatim
quotes — has never been driven by a real model against a real target. Four phases in a row, running
the thing found defects that reading it had not, and there is no reason to expect this one to be
the exception.

---

## 15. Phase 7 — the live run that Phase 6 owed, and the three defects it found

§14.7 said this: *"Four phases in a row, running the thing found defects that reading it had not,
and there is no reason to expect this one to be the exception."* It was not the exception.

`run_90f1c9f5` was the first end-to-end run with a PRD, an intent and credentials all supplied at
once: ShopLite, `docs/shoplite-prd.md`, *"focus on checkout and authentication flows"*, five
scenarios, a $1.50 ceiling. It signed in, mapped four routes, planned five scenarios, passed
critique, and then **quarantined every single one of them.** Execute ran an empty suite, Triage had
no failures to classify, Heal had nothing to repair, and Report published — correctly, and
uselessly — a report about nothing, for $0.26.

Every stage behaved exactly as designed. That is what made it worth the money.

### 15.1 The Generator was never given the credentials

Its own quarantine reason, verbatim:

> The live page exposes the sign-in form, protected Products/Basket pages, and the generic
> invalid-credentials error, but no valid ShopLite password was provided or discoverable for
> ada@shoplite.test.

The Generator inherits a signed-in browser, so for most scenarios the question never comes up. But
a scenario about *signed-out* behaviour drops the session deliberately — Phase 5 added the
`test.use({ storageState: … })` instruction for exactly that — and then it has to type a password
nothing ever told it. Phase 5 listed "a signed-out scenario versus a signed-in suite" as unverified.
This is what was wrong with it, and only a run could have said so.

The fix has two halves, in `agents/credentials.ts`:

- **`credentialsBriefing`** puts the username and password into the Planner's and the Generator's
  prompts, and tells the Generator to write `process.env.ODYSSEY_PASSWORD` into the file rather
  than the value.
- **`redactPassword`** then does not trust it. Every quoted occurrence of the password in the
  emitted code is rewritten to that expression before the file exists on disk, and the rewrite is
  reported as a tool call. A password that appears *inside* a longer string literal is flagged
  rather than spliced, because guessing at how to interpolate into someone else's string is how a
  rewrite turns a working test into a syntax error.

`executor.ts` supplies the value to the Playwright child process, which already had a deliberately
minimal environment. So the suite is committable: `tests/` holds no secret, and the runner has one.

### 15.2 The Planner was writing scenarios that cannot be walked

Two of the five quarantines were not about credentials at all:

> The live ShopLite application exposes no UI or reachable test hook to configure authentication,
> catalogue, or basket requests to fail…

The PRD says *"any failure the shopper causes or suffers is shown in the page"* and *"if order
history cannot be loaded, the page must say so"*. Both are real requirements. Neither is reachable
from the application's own interface, and a scenario that asks the Generator to reach one produces
nothing at all — not a weaker test, *nothing*. The scenario slot is spent and the requirement is
still uncovered, which is strictly worse than never planning it: the run has a risk ledger and a
PRD trace whose whole job is to report exactly that gap, for free.

Two instructions were added to the Planner, and one to the Generator:

- **One flow per scenario.** The run's actual titles were things like *"Authenticate successfully,
  reject invalid credentials, and guard protected pages"* — three flows in one slot. Bundling is not
  more coverage for the budget; it is an all-or-nothing bet, because one unreachable clause
  quarantines the other two along with it.
- **Plan only states reachable through the application's own interface** — unless Recon actually
  observed a control that produces the failure, in which case it is fair game.
- And the Generator may now **emit the part it can prove and name the clause it dropped**, rather
  than treating one unreachable clause as a reason to emit nothing.

### 15.3 The orchestrator accepted "ship nothing" and carried on

This is the interesting one, because nothing was broken. The FSM did what it was told: generate,
then execute. It had two re-plans left in its allowance and spent neither, because "the plan cannot
be built" was not a condition anything tested for.

The brief names *deciding when to re-plan* as the first thing an orchestrator is for, so:

`orchestrator/regenerate.ts` — `afterGeneration()` returns `proceed`, `replan` or `escalate`. One
emitted test is enough to proceed (deliberately not a threshold: trading a suite that exists for a
suite that might be bigger is a bad trade, and the quarantine reasons are usually right). Nothing
emitted, with allowance left, re-plans — and the directives handed back are the Generator's own
quarantine sentences, verbatim, because they are the only record of what the live application
refused to give. Nothing emitted with the allowance spent, or over budget, escalates and says so.

It lives in its own module for the same reason `risk-signals.ts` and `prd-gate.ts` do: a judgment
that can only be exercised by spending $0.26 and eleven minutes is a judgment nobody re-checks. As
a pure function it is eight assertions and two milliseconds.

### 15.4 The console was showing seeded data without saying so

Not found by the run — found by reading the console the way a judge would. Five pages describe a
*fleet*: Overview, Coverage, Defects, Schedule, Targets. This build drives one run at a time, so
their data is seeded, and the navigation carried a hard-coded `4` on the Defects tab.

On a product whose entire argument is *"every number here is measured or it is not printed"*, that
is the one contradiction it cannot afford. Every one of those pages now carries a `SampleNotice`
banner naming itself as seeded, the fabricated nav badge is gone, and `/runs` — which merges real
runs with seeded history — marks each seeded row `sample`. Labelled, rather than removed: a console
with no fleet view tells a first-time reader nothing about what the product is for.

### 15.5 Submission artifacts

`SUBMISSION.md` maps every Must Have, Good to Have and Bonus in the brief to the file that
implements it and the artifact that proves it. `docs/architecture.svg` is the required architecture
diagram, generated by `scripts/build-architecture.mjs` and embedded in both the README and the deck. `docs/DEMO.md` is the run of show for the video, including a table of what to say when
something goes wrong on stage. `docs/the-odyssey-deck.pptx` is the deck. `docs/shoplite-prd.md` is
the PRD the demo run supplies — written against ShopLite as built, with two requirements it
deliberately does not implement, so the PRD trace has something true to say.

### 15.6 Tests

`pnpm verify` — typecheck, lint and **117 assertions**, up from 101. New:

- `agents/credentials.test.mts` — the rewrite across all three quote styles, the buried-literal case
  that must be flagged rather than spliced, a password containing regex metacharacters, and that an
  empty password is a no-op rather than a regex matching everything.
- `orchestrator/regenerate.test.mts` — proceed on one test, re-plan on none, escalate when the
  allowance is spent or the budget is gone, that the directives carry the Generator's own sentence,
  and that an over-budget run which *did* emit tests still runs them.
