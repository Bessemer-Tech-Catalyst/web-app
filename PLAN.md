# Crucible — The Plan (read this one)

*Bessemer Tech Catalyst · AI/ML Track · Autonomous Test Orchestration Agent*

---

## The name

# 🔥 Crucible

A **Bessemer converter is a crucible** — you blast air through molten iron and the impurities
burn off, leaving steel. That's exactly what this tool does to a web app, and it's named after
the process the event's namesake invented. Judges from Bessemer will get it in half a second.

**Tagline:** *Put your app in the crucible.*

Backups if you don't like it: **Argus** (the hundred-eyed watchman — all-seeing coverage),
**QAtalyst**, **Testudo**.

---

## The one thing that decides whether we win

I found this in research and it changes everything:

> **Playwright already ships a Planner, a Generator, and a Healer.**
> `npx playwright init-agents` installs all three, today, for free.

The problem statement names those three agents *word for word*. So the challenge is **not**
"build a planner, a generator and a healer" — those exist, and every team will wire them up.

Read the brief again and it says so out loud:

> *"What they do not do is orchestrate these capabilities end to end — deciding when to plan,
> when to generate, when to heal, and when to escalate — without a human directing each step."*

Playwright's own docs literally tell you to **keep a human approval gate after planning, after
generation, and after healing.** Our job is to delete those three humans and replace them with
machine judgment.

**So: the sub-agents are table stakes. The orchestrator is the product.**
Most teams will spend 90% of their time on the pipeline and demo "URL in → tests out." They'll
all look the same. We spend our time on the *decisions*, and we make those decisions **visible**.

---

## What Crucible actually does

You paste a URL. Optionally a PRD and a sentence like *"focus on checkout and auth."*
Then it runs itself:

```
   URL
    ↓
1. RECON      logs in, crawls the app, maps every screen and button
    ↓
2. PLAN       writes a human-readable test plan — real user flows, not just happy paths
    ↓
3. CRITIQUE   ★ grades its own plan. Finds gaps. Sends it back to be re-planned if it's weak.
    ↓
4. GENERATE   writes real Playwright test files — and proves every selector on the live page
    ↓
5. EXECUTE    runs the suite, in parallel
    ↓
6. TRIAGE     ★ for each failure: is the test broken, or is the APP broken?
    ↓
7. HEAL       fixes broken tests. Refuses to touch real bugs. Escalates what it can't fix.
    ↓
8. REPORT     what we covered, what passed, what we healed, what we skipped, and what that risks
```

The ★ steps are ours. They're the reason we win.

---

## The five ideas that make it more than a pipeline

### 1. It grades its own test plan before writing a single test
The brief demands this ("evaluate the plan for coverage gaps *before* passing it to the
Generator"). We score every plan on a fixed rubric — negative paths, error states, edge cases,
permission variants, destructive actions. If the score is weak, the orchestrator **rejects its
own plan** and re-plans with specific instructions about what's missing.

> **On stage:** *"Watch — it just scored its own plan 61 out of 100, listed six missing flows,
> re-planned, and came back with 88. Nobody told it to do that."*

### 2. It refuses to write a selector it hasn't proven
The Generator isn't allowed to guess a locator. It has to find the element on the live page
first. If it can't, the scenario gets **quarantined with a reason** instead of becoming a fake
test.

This is why our demo won't be 40 tests with 38 red. Twelve honest green tests plus *"8 scenarios
quarantined, here's exactly why"* is a better product **and** a better demo.

### 3. It knows the difference between a broken test and a broken app ← the hard one
This is a Bonus item in the brief and it's the thing most teams will fudge.

On every failure we collect an evidence bundle — the error, a snapshot of the page at the moment
it failed vs. what the page looked like when the test was written, console errors, network logs
(any 500s?), a screenshot, whether that same selector worked an hour ago, and whether other tests
touching the same button also failed. Then we classify:

| Verdict | What it means | What we do |
|---|---|---|
| **Script drift** | The button moved | Heal it |
| **Real app bug** | A 500, a JS crash, wrong business logic | **File a bug. Do NOT heal.** Leave it red. |
| **Flake** | Timeout, network hiccup | Retry once |
| **Bad plan** | We tested a feature that doesn't exist | Send it back to the planner |

> **On stage:** *"Healing a real bug is the cardinal sin of self-healing tests — you'd be deleting
> the exact signal you built the suite to find. So our healer isn't even allowed to start until
> the classifier confirms the app is fine and the script is wrong."*

That line alone is worth points.

### 4. The healer isn't allowed to cheat
The easiest way to make a failing test pass is to weaken its assertion. Our healer can rewrite
**locators and waits**, but we diff the assertions before and after every patch — if it deleted
one, loosened one, or changed an expected value, **the patch is rejected** and the test escalates.

Simple, cheap, and nobody else will have thought of it.

### 5. It tells you what it *didn't* test, and why that's dangerous
The brief asks for "untested flow risk." Everyone will skip it. We score every screen we found
but didn't cover:

> *"Password reset — **HIGH RISK**, untested. Reachable from the login page, touches credentials,
> and it's named in section 4 of your PRD."*

That's the slide that makes a VC-backed company want to hire the team.

---

## What it looks like

Two screens.

**1. Launcher** — one big URL box (that's the only required input, per the brief), plus optional
PRD drop and a "what should I focus on?" sentence.

**2. Mission Control** — this is the demo. Live, as it runs:

- a **pipeline rail** across the top showing which stage is active
- the **Decision Log** — the hero panel. A live feed of *"I chose X because Y (confidence 0.82),
  based on this evidence."* Every single judgment the orchestrator makes, in plain English.
- agent activity, artifacts appearing as they're created (plan → tests → screenshots → patches)
- a live **cost meter** and timer

Judges score "how clearly does the team present the agent's decisions" at 15%. That Decision Log
panel is basically all 15 points.

---

## Tech stack

React + TypeScript + Tailwind, as you asked — via **Next.js**, which *is* React. You'll write
normal React components the whole way.

The reason for Next specifically: Playwright has to run on a real Node machine with real browser
binaries, so we need a backend no matter what. Next.js lets that backend live in the same project
as the React app, so there's one thing to run and one thing to deploy.

| Piece | What | Why |
|---|---|---|
| UI | React 19 + TypeScript + Tailwind v4 | What you know |
| App/server | Next.js 16 (App Router) | React frontend + Node backend, one process |
| Agents | Claude Agent SDK | Gives us sub-agents, file writing, and shell access out of the box |
| Brains | Claude Opus 5 | The orchestrator's judgment calls are the whole thesis — don't cheap out here |
| Browser | Playwright MCP | Reads the page's accessibility tree, not screenshots — faster, cheaper, far less flaky than vision |
| Tests | Real Playwright test files | They must be real files a team could actually commit |
| Storage | Local files | ← see below |

### Do we need Supabase or a backend? — **No Supabase. Yes, a backend (it's built into Next).**

I looked at this properly and the answer is a clear no:

1. **Supabase can't run Playwright.** Edge functions can't launch a browser. So we need a Node
   backend regardless — Supabase would be an *extra* tier, not a replacement for one.
2. **There's nothing relational here.** One user, one run at a time. The only "query" we ever run
   is "show me recent runs."
3. **All our data is files.** Traces, videos, screenshots, `.spec.ts` files. Playwright's own
   viewer expects them on disk. Putting them in cloud storage means downloading them back.
4. **Demo risk.** Hackathon wifi is hostile. Every network call is a way to fail live in front of
   judges. Local files can't drop out.

Instead every run writes an **append-only event log** (`events.ndjson`) — which gets us database,
crash recovery, replay, and time-travel scrubbing from one file.

We'd only add Supabase if we later want shareable hosted report links. It's behind an interface,
so it's a swap, not a rewrite.

---

## Build order

| Phase | What | Status |
|---|---|---|
| 0 | Research + this plan | ✅ done |
| **1** | **The UI** — both screens, fully working, driven by a realistic fake run | ◀ **building now** |
| 2 | The orchestrator state machine + real live streaming + saved runs | |
| 3 | Recon + Planner + the Coverage Critic (real browser, real Claude) | |
| 4 | Generator with live selector proving + parallel test execution | |
| 5 | Triage + Healer + the assertion guard | |
| 6 | Final report, PRD gap analysis, risk ledger, screenshot/video viewer | |
| 7 | Demo rehearsal, README, architecture diagram, deck, video | |

Phase 1 is deliberately built against the *real* data shapes with fake data flowing through them.
So when phase 2 plugs in the real engine, **the UI doesn't change at all.** No rework.

---

## Three things we must not forget

1. **Record a perfect run the night before.** The event log replays at real pacing. If the wifi or
   the API dies mid-demo, we switch to replay and keep talking. We'll *tell* the judges it exists —
   it's good engineering, not a cheat.
2. **Bring our own test app.** The brief explicitly warns not to wait for the organiser's URL.
   We ship a small shop app with auth + checkout **and a deliberate bug behind a feature flag**, so
   we can trigger "real app bug detected" on command, live. Plus one public app to prove it
   generalises.
3. **Put a cost meter and a hard budget on screen.** Judges notice. And it stops a runaway agent
   from eating the demo clock.

---

## What we're building right now

Phase 1: both screens, the design system, the full data model, and a scripted fake run so you can
watch the entire pipeline stream end to end today — before a single line of agent code exists.

The detailed engineering version of this plan is in
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).
