# Crucible — Implementation Plan (working doc)

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

**Crucible.** A Bessemer converter is a crucible — you blast air through molten iron and the
impurities burn off, leaving steel. That is exactly what this does to a web app, and it is named
after the process the venue's namesake invented. Tagline: **"Put your app in the crucible."**

Backups if it clashes: **Argus** (hundred-eyed watchman), **QAtalyst**, **Testudo**.

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
| Agent harness | `@anthropic-ai/claude-agent-sdk` (v0.3.x) | Gives the Claude Code harness as a library: subagents via `agents: Record<string, AgentDefinition>`, `mcpServers`, Read/Write/Edit/Bash built in, streaming `SDKMessage`s, `maxBudgetUsd`. Writing test files + running `npx playwright test` is *free* with it. |
| Judgment calls | `@anthropic-ai/sdk` with `output_config.format` (structured outputs) | Critic / Classifier / Risk must return typed JSON, not prose. Don't use an agent loop for a single scored decision. |
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

Default every agent to **`claude-opus-5`** with adaptive thinking; effort is the cost dial:

| Component | Model | Effort | Why |
|---|---|---|---|
| Orchestrator / Critic / Classifier | `claude-opus-5` | `high` | These are the judgment calls — the whole thesis |
| Planner | `claude-opus-5` | `high` | Open-ended exploration |
| Generator | `claude-opus-5` | `xhigh` | Generated-code quality is 20% of the score |
| Healer | `claude-opus-5` | `high` | Long agentic loop |
| Recon crawl summarisation | `claude-haiku-4-5` | — | High volume, low judgment |

Expose per-agent model in Settings so we can downshift to `claude-sonnet-5` if we're burning
credits during dev. Set `maxBudgetUsd` per run; surface live cost in the UI (judges love it).

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
| **1** ◀ *now* | **UI shell.** Next.js scaffold, design system, `types.ts`, launcher page, mission-control page, report page, mock event emitter driving the whole thing | `pnpm dev` → enter a URL → watch a full fake pipeline stream, end to end, looking real |
| **2** | Orchestrator FSM + real SSE + run store + workspace scaffolder. Agents still deterministic stubs | A real run row persists; UI streams from `events.ndjson`, not mocks; crash/reload resumes |
| **3** | Recon + Planner (Agent SDK + Playwright MCP) + Coverage Critic + replan loop | Real `specs/*.md` from a real URL; a real critic verdict; a visible replan |
| **4** | Generator w/ live selector validation + executor (`playwright test --reporter=json`) + shard parallelism | Real green tests on the demo target |
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

- [ ] Do we run Playwright MCP as one long-lived server per run (`--port`, HTTP) or stdio per
      sub-agent? Long-lived + `--isolated` is likely right so Recon's auth state carries to Planner.
- [ ] Credential handling: env-var reference vs. encrypted-at-rest in `input.json`. Never log them —
      add a redaction pass on the event writer *before* Phase 3.
- [ ] Parallel execution: Playwright `--shard` (simple) vs. our own worker pool (more control over
      per-flow isolation). Start with `--shard`, `fullyParallel: true`.
- [ ] PRD ingestion: PDF parsing needed, or paste-as-markdown only for the demo? Start with paste
      + `.md`/`.txt` upload; add PDF only if time remains.
