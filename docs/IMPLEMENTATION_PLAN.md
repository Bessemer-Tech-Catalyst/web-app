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
| **4** ◀ *now* | Generator w/ live selector validation + executor (`playwright test --reporter=json`) + shard parallelism | Real green tests on the demo target |
| **5** | Triage/classifier + Healer + assertion-integrity guard + bounded re-execute | A deliberately broken selector gets healed; a deliberately broken app gets filed as a bug, *not* healed |
| **6** | Report synthesis, PRD gap analysis, risk ledger, artifact viewer (trace/video/screenshot) | The report answers all six must-have bullets |
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

## 11. Open items for Phase 4

### Blocking

- [ ] **`playwright test` has no session.** It cannot use a Chrome `--user-data-dir` and needs its
      own `storageState` file. Recommended: dump it from the shared profile after Recon closes
      (`launchPersistentContext` → `storageState({path})`), which reuses the mechanism already
      proven. The alternative — the Generator reproducing the login as Playwright code — is more
      agentic and has more ways to fail live.
      Note the target app authenticates via **localStorage, not cookies**; `storageState` captures
      both, but a cookies-only assumption would silently produce a logged-out suite.
- [ ] **`GENERATOR_TOOLS` allowlist.** `createPlaywrightServer` takes `agent: "recon" | "planner"`
      and needs a third. Keep the allowlist positive — `browser_evaluate` and
      `browser_run_code_unsafe` stay out for the Generator too.
- [ ] Recon no longer writes `tests/seed.spec.ts` (the one it wrote never logged in). Whatever
      produces the real one is Phase 4's job.

### Credibility — small, and a judge could catch any of them

- [ ] **The confidence badges are fake.** Every `decision` renders a percentage and **11 of the 12
      are hardcoded literals**. Only the triage verdict computes one, as `Math.min` of the
      classifier's per-failure confidences. The badge is on the panel §5 calls the hero of the 15%
      UX score, so *"what does 96% mean?"* is a likely question with no answer today.
      **Recommended: render the badge only where something computed it.**
- [ ] **A zero-test run still reports `succeeded`.** The Decision Log says so plainly now; the
      status field does not. Changing it touches the run list.
- [ ] Redaction runs *after* truncation on tool summaries, so a secret cut mid-string can slip past
      `redact()`, which matches whole values. Redact first, then truncate.

### Tuning

- [ ] **`maxReplans: 1` is now the binding constraint**, not the scenario cap. First-pass scores
      land 62–68 and revisions 72–82, so one re-plan is a coin flip on whether the demo shows an
      accepted plan or a spent allowance. **Run the demo at `maxReplans: 2`.**

### Not started, and not in any phase

- [ ] **The demo target with the feature-flagged deliberate bug.** The only way to trigger
      `APP_DEFECT` on command, which is the strongest moment in the demo. Needed the moment the
      Healer is real in Phase 5. §7 has called it non-negotiable since Phase 0 and it still has no
      phase, no owner and no line in the table above — which is how it will fail to exist.
