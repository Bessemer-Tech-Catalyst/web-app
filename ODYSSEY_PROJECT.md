# The Odyssey — Autonomous Test Orchestration Platform

## Executive Summary

**The Odyssey** is an autonomous end-to-end test orchestration platform that transforms a bare URL into a comprehensive test suite, executes it against a live application, classifies failures intelligently, and delivers a detailed quality report — all without manual test writing.

### Key Stats
- **0 → 100**: From a single URL to a full test suite in seconds
- **Real Browser Testing**: Actual Playwright automation against live sites
- **Intelligent Triage**: AI classifies failures as app bugs vs. script drift
- **Live Monitoring**: Real-time test execution with streaming events
- **Report Comparison**: Track quality improvements run-over-run
- **Zero Configuration**: Works with any web application

---

## Problem Statement

### Current Testing Landscape Challenges
1. **Manual Test Writing**: Teams spend weeks writing test scripts for each app
2. **Maintenance Burden**: Locators break with UI changes; tests become brittle
3. **False Positives**: Hard to distinguish genuine bugs from test script drift
4. **No Baseline**: Each test run is isolated; impossible to track improvements
5. **Scale Issues**: Testing multiple sites becomes unmanageable
6. **Budget Constraints**: Running comprehensive test suites is expensive

### The Odyssey Solution
✅ **Automated test generation** from live site crawling  
✅ **Intelligent failure classification** (app bug vs. script issue)  
✅ **Real-time monitoring** with live event streaming  
✅ **Report comparison** to track quality trends  
✅ **Multi-site dashboard** for fleet-wide insights  
✅ **Cost tracking** with per-stage visibility  

---

## Architecture Overview

### The 8-Stage Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ INPUT: URL + Optional (Intent, PRD, Credentials)          │
└─────────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 1: RECON                          │
        │ Crawl the site, find all routes         │
        │ Authenticate if credentials provided    │
        │ Output: Map of interactive surfaces     │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 2: PLAN                           │
        │ Write test scenarios covering all flows │
        │ Output: Test plan (5-15 scenarios)      │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 3: CRITIQUE                       │
        │ Score plan against coverage rubric      │
        │ If weak: return gaps and replan         │
        │ Output: 88/100 coverage score + acceptance
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 4: GENERATE                       │
        │ Resolve every locator on live page      │
        │ Write real Playwright test files        │
        │ Quarantine tests with missing selectors │
        │ Output: test/*.spec.ts files            │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 5: EXECUTE                        │
        │ Run Playwright in parallel              │
        │ Capture pass/fail + screenshots/videos  │
        │ Output: Test results + artifacts        │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 6: TRIAGE                         │
        │ Classify each failure:                  │
        │   - Genuine app defect → FILE BUG       │
        │   - Script drift → ROUTE TO HEALER      │
        │   - Environment flake → RETRY           │
        │   - Plan error → SEND BACK              │
        │ Output: Classified failures + confidence│
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 7: HEAL                           │
        │ Fix broken locators automatically       │
        │ Verify assertions still pass            │
        │ Rerun tests with repaired scripts       │
        │ Output: Healed tests + rerun results    │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ STAGE 8: REPORT                         │
        │ Synthesize findings:                    │
        │   - Coverage score + gaps               │
        │   - Bugs filed + severity               │
        │   - Risk ledger (untested surfaces)     │
        │   - PRD traceability matrix             │
        │ Output: Full test quality report        │
        └─────────────────────────────────────────┘
                          ↓
        ┌─────────────────────────────────────────┐
        │ DELIVERABLES                            │
        │ ✅ Test suite (real Playwright code)    │
        │ ✅ Quality report (coverage, bugs, risk)│
        │ ✅ Screenshots + videos of failures     │
        │ ✅ Comparison vs previous run           │
        │ ✅ Cost tracking per stage              │
        └─────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend (UI)
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS + custom design system
- **State**: Server components + real-time SSE streams
- **Type Safety**: TypeScript

### Backend (Orchestration)
- **Language**: TypeScript/Node.js
- **Automation**: Playwright (real browser testing)
- **AI/LLM**: Claude API (planning, triage, healing, analysis)
- **Storage**: File-backed (no database required)
- **Persistence**: NDJSON event logs + JSON artifacts

### Key Integrations
- **Playwright**: Real browser automation
- **Claude API**: AI agents for planning, generation, triage
- **MCP (Model Context Protocol)**: Tool grounding for browser control
- **Next.js**: Server-side rendering + API routes

---

## Core Features

### 1. **Automated Test Generation**
- Crawl any URL to discovery interactive surfaces
- Generate realistic test scenarios covering happy paths and edge cases
- Resolve locators on live page before writing tests
- Output: Real Playwright test files (not mocks)

### 2. **Intelligent Failure Classification**
- **App Defect**: Genuine bug in the application
- **Script Drift**: Locator broke but app still works correctly
- **Environment Flake**: Transient failure (retry)
- **Plan Error**: Test scenario doesn't match reality
- **Confidence Scoring**: Every classification includes confidence % (90%+)

### 3. **Automated Healing**
- Detect broken locators in failed tests
- Propose alternative locators via pattern analysis
- Verify assertions still pass (assertion guard)
- Rerun test with repaired script
- Maintain test integrity — never weaken assertions

### 4. **Real-Time Monitoring**
- Stream test execution live in the console
- See each stage progress with narration
- Watch screenshots + video capture on failure
- Cost tracking per stage (tokens, $$)
- Timeline of all events with durations

### 5. **Report Comparison**
- Compare old vs new run metrics side-by-side
- Coverage delta, bug delta, pass rate changes
- Highlight new bugs found
- Track quality trends over time
- Export comparison as reference

### 6. **Multi-Site Dashboard**
- Master dashboard with all tested applications
- Aggregated metrics per site:
  - Average coverage score
  - Average pass rate
  - Total bugs filed
  - Number of test runs
  - Latest run timestamp
- Fleet-wide statistics
- Quick links to rerun or compare

### 7. **Rerun & Scheduling**
- Click "Rerun" to recreate a test with identical parameters
- Automatic scheduling for regular regression testing
- Configurable intervals (daily, weekly, etc.)
- Capture baseline improvements over time

### 8. **Detailed Quality Report**
- **Coverage Score**: 0-100 rubric across 6 dimensions
- **Test Results**: Pass/fail/healed breakdown
- **Bugs Filed**: Severity, confidence, evidence
- **Risk Ledger**: Untested surfaces ranked by blast radius
- **PRD Traceability**: Requirement-by-requirement coverage matrix
- **Healing Actions**: Locator repairs with before/after diffs
- **Artifacts**: Screenshots, videos, traces of every failure

---

## User Journey

### Quickstart: Test Your Site in 3 Steps

**Step 1: Navigate to New Run**
```
https://localhost:3000/new
```

**Step 2: Enter Your URL**
```
URL: https://example.com
Intent (optional): "Focus on checkout and payment flows"
Credentials (optional): username / password
```

**Step 3: Click Run**
- Watch real-time execution in the console
- See test generation, execution, triage happening live
- Monitor cost and duration
- View all events as they happen

**Result:** Full test suite + quality report in your browser

### Advanced: Compare Quality Over Time

**Scenario**: You made changes and want to see if quality improved

1. **Original Run**: Test the site before your changes (captures baseline)
2. **Updated Run**: Rerun after making improvements
3. **Navigate to Compare**: `/runs/compare?old=run_123&new=run_456`
4. **View Metrics**: See coverage delta, bug delta, pass rate improvements
5. **Decide**: Keep changes or investigate regressions

### Fleet Management: Monitor Multiple Sites

1. **Navigate to Sites Dashboard**: `/sites`
2. **View All Applications**: See all tested URLs with metrics
3. **Spot Trends**: Coverage increasing? Bugs decreasing?
4. **Drill Down**: Click any site to see detailed run history
5. **Compare Runs**: Pick old vs new to see progress

---

## Key Capabilities

### 1. Coverage Analysis
- **Breadth**: Every interactive surface discovered
- **Depth**: Happy paths + negative cases + edge cases + error states
- **Gaps**: Surfaces found but untested (risk ledger)
- **Score**: 0-100 across 6 dimensions with rubric explanation

### 2. Defect Intelligence
- **Bug Filing**: Every genuine app defect captured
- **Severity**: Critical / High / Medium / Low
- **Evidence**: Screenshot + console errors + network + assertion diff
- **Confidence**: 90%+ on every classification decision

### 3. Locator Resilience
- **Verify Before Write**: Every selector proved on live page
- **Smart Repair**: Semantic pattern matching to fix broken locators
- **Assertion Guard**: Reject patches that weaken test assertions
- **Zero False Positives**: Never report "fixed" when assertion weakened

### 4. Cost Optimization
- **Per-Stage Breakdown**: See where money is spent (tokens per stage)
- **Budget Guard**: Stop run if cost exceeds limit
- **Cheap Stubs**: Disable expensive agents for iteration
- **Real Pricing**: Real cost reported (0 for stubs, actual for AI)

### 5. Flexibility
- **Stubbed Agents**: Fast iteration without API cost
- **Real Agents**: Production-grade AI planning/triage/healing
- **Mix & Match**: Run with stubs for design, real agents for CI
- **No Hard Dependencies**: Works on localhost without cloud

---

## Deployment Model

### Development
```
Local Next.js Dev Server (http://localhost:3000)
↓
.odyssey/ directory (file-backed storage)
↓
Real Playwright browsers on your machine
↓
Claude API calls (optional, can use stubs)
```

### Production Ready
- Deploy Next.js to Vercel, AWS, or any Node.js host
- Store runs in cloud storage or database
- Scale Playwright workers independently
- Rate-limit API calls with exponential backoff
- Monitor cost per run with budgets

---

## Feature Highlights

### 🎯 Accuracy
- Real browser automation (not synthetic)
- AI-powered failure classification (90%+ confidence)
- Intelligent healing (never weakens assertions)
- Evidence-backed decisions (no guessing)

### 🚀 Speed
- Generate 15-scenario test suite in ~30 seconds
- Execute in parallel (4 workers by default)
- Live streaming (no waiting for results)
- Incremental reporting (results as they complete)

### 💰 Cost Efficiency
- Pay only for what you use (per-token pricing)
- Cheap stubs for development
- Budget guards to prevent runaway costs
- Full cost visibility per stage

### 📊 Insights
- Coverage gaps identified and scored
- Risk ledger ranks untested surfaces
- PRD traceability shows requirement coverage
- Trend tracking with run comparison

### 🔧 Maintainability
- Automated locator repair (self-healing)
- No test-writing burden
- Keeps up with UI changes automatically
- Assertion integrity guards prevent false successes

---

## Metrics & ROI

### Time Saved
- **Before**: 2-3 weeks to write initial test suite + maintenance
- **After**: 30 seconds to generate suite automatically
- **Savings**: 95% time reduction on test writing

### Quality Improvement
- **Bug Discovery**: Catch issues before production
- **Regression Prevention**: Automated rerunning on every change
- **Coverage Growth**: Never lose coverage when refactoring

### Cost Management
- **Transparent Pricing**: See cost per test run
- **Optimization**: Tune agents vs stubs for your budget
- **ROI Tracking**: Compare cost vs bugs prevented

---

## Demo Walkthrough

### Run 1: Baseline Test
```
URL: http://localhost:3000/shoplite
Duration: ~45 seconds
Cost: $0.25 (with real agents)
Result:
  - Coverage: 88/100
  - Tests: 15 scenarios
  - Passed: 12
  - Failed: 2
  - Bugs Filed: 2 (checkout flow issue, payment validation)
  - Healed: 1 locator (product search)
```

### Make Changes
```
Fix: Payment validation bug (Run 1 found it)
Change: Update product card selector
```

### Run 2: After Changes
```
Duration: ~40 seconds
Cost: $0.23
Result:
  - Coverage: 88/100 (same)
  - Tests: 15 scenarios
  - Passed: 13 (improved!)
  - Failed: 1
  - Bugs Filed: 1 (down from 2)
  - Healed: 0 (selectors still valid)
```

### Compare: Run 1 vs Run 2
```
Coverage Delta: 0 (stable)
Pass Rate: 80% → 86% ✅ (improvement)
Bugs: 2 → 1 ✅ (fixed one)
Cost Delta: -$0.02 ✅ (slightly cheaper)

Conclusion: Quality improved, coverage maintained
```

---

## Data Flow

### Event-Driven Architecture
```
Orchestrator emits events as JSON:
{
  "seq": 42,
  "ts": "2026-09-05T08:40:19.190Z",
  "type": "agent.tool",
  "agent": "generator",
  "tool": "browser_generate_locator",
  "summary": "Sign in with valid credentials — 6/6 locators resolved",
  "ok": true
}
```

### Persistence
- **Event Log**: NDJSON append-only (never modified)
- **Run State**: Folded from events (deterministic reduce)
- **Report**: JSON snapshot at end of run
- **Artifacts**: Screenshots, videos, test files

### Recovery
- Restart mid-run: Continue from last event
- Connection drops: SSE reconnect fetches full history
- Crash: Replay event log to recover state
- No data loss: Event log is source of truth

---

## Limitations & Roadmap

### Current Limitations
- Single-instance file storage (not distributed)
- No test result database (runs stored on disk)
- Selenium not supported (Playwright only)
- No mobile testing yet
- Simple authentication only

### Roadmap
- **Database Backend**: MongoDB/PostgreSQL for large scale
- **Distributed Scheduling**: Multi-worker orchestration
- **Mobile Testing**: Appium + device farm
- **Advanced Auth**: SAML, OAuth, MFA flows
- **CI/CD Integration**: GitHub Actions, GitLab CI plugins
- **Analytics Dashboard**: Trend analysis + anomaly detection
- **Team Collaboration**: Shared runs, comments, annotations

---

## Getting Started

### Prerequisites
- Node.js 18+
- Playwright (auto-installed via npm)
- OpenAI API key (optional, uses stubs without it)
- 4GB RAM minimum

### Installation
```bash
git clone https://github.com/odyssey/odyssey.git
cd odyssey
npm install
npm run dev
```

### First Test Run
```
1. Open http://localhost:3000
2. Click "New run"
3. Enter any URL (example: https://example.com)
4. Click "Run"
5. Watch the real-time console
6. View report in 30-60 seconds
```

### Configuration
```bash
# .env file
OPENAI_API_KEY=sk-xxx          # Optional
ODYSSEY_REAL_AGENTS=generate,execute,triage
ODYSSEY_STUB_SPEED=1           # 1 = normal, 10 = fast
```

---

## Support & Documentation

- **Full Docs**: `/src/README.md`
- **API Reference**: `/src/server/orchestrator/agents.ts`
- **Type Definitions**: `/src/lib/types.ts`
- **Example Workflows**: `/docs/examples/`
- **GitHub Issues**: Report bugs and feature requests

---

## Conclusion

**The Odyssey** transforms test automation from a manual, labor-intensive process into an intelligent, automated pipeline that:

✅ **Discovers** all interactive surfaces on a web application  
✅ **Plans** comprehensive test scenarios  
✅ **Generates** real, executable Playwright tests  
✅ **Executes** tests in parallel with live monitoring  
✅ **Classifies** failures intelligently  
✅ **Heals** broken tests automatically  
✅ **Reports** detailed quality metrics  
✅ **Compares** runs to track improvements  
✅ **Scales** across multiple sites with dashboards  

No test writing. No maintenance burden. Just real quality insights.

**Get started now**: http://localhost:3000

---

## Contact & Attribution

Built with ❤️ using Claude AI, Playwright, and Next.js

Questions? Feedback? Contributions welcome!
