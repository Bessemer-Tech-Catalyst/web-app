# The demo — run of show

Four and a half minutes, one browser, one terminal. Written to be read aloud while the
pipeline runs, and to survive a target the organisers hand you on the day.

The pipeline takes 8–12 minutes end to end against ShopLite. **The video is not a single
unedited take** — start the run, narrate the stages that matter live, and cut to the
finished report. Everything the script claims is on screen at the moment it is claimed.

---

## Before you start

```bash
pnpm install
pnpm exec playwright install chromium
printf 'OPENAI_API_KEY=sk-…\nODYSSEY_REAL_AGENTS=all\n' >> .env
pnpm dev --port 3002
```

```bash
pnpm demo:reset          # order history cleared, both defect switches off
pnpm verify              # typecheck, lint, 117 assertions — ~2s, in case a judge asks
```

Have four things open:

| | |
|---|---|
| Tab 1 | `http://localhost:3002/new` — the launcher |
| Tab 2 | `http://localhost:3002/shoplite/control` — the two defect switches |
| Terminal | this repo |
| Nothing else | the run opens its own Chrome, and that window is half the demo |

---

## 0:00 — the problem, in one breath

> "Playwright already ships a Planner, a Generator and a Healer. `npx playwright
> init-agents` installs all three today, for free. Read the brief again and it says so
> too — and then it says what is actually missing: *nobody orchestrates them.* Playwright's
> own documentation tells you to keep a human approval gate after planning, after
> generation, and after healing. This deletes those three humans."

Show `docs/architecture.svg` for five seconds. Point at the four ★ stages. Move on.

## 0:30 — start it

Tab 1. Paste `http://localhost:3002/shoplite`, the credentials, drop in
`docs/shoplite-prd.md`, type the intent — *"focus on checkout and authentication
flows"* — and press start. Or, from the terminal:

```bash
pnpm demo:run
```

> "One URL is the only required input. The PRD and that sentence are optional, and both
> change what it plans."

## 0:50 — Recon, and the first decision

The Chrome window appears and signs itself in. The Decision Log fills.

> "It signed in with the credentials and it is crawling authenticated. Every line on the
> right is a decision with its rationale and the evidence behind it — that panel is
> written from an append-only event log on disk, which is also the crash-recovery story
> and the replay mechanism. One file per run."

## 1:20 — the Critic rejects its own plan

Wait for the critique. **This is the money shot of the first half.**

> "It just scored its own test plan out of a hundred across six dimensions, against what
> Recon actually observed — and rejected it. Seven named gaps. It is now re-planning
> against those gaps specifically, not planning again and hoping."

If it passes first time, say that instead and show the six dimension scores. Do not wait
for a rejection that is not coming.

## 2:00 — the Generator refuses to guess

Point at the locator counts as tests appear: `14/14 locators resolved on the live page`.

> "Every selector in that file was resolved by Playwright itself, on the live page,
> minutes ago — and the file is then checked against a ledger of what actually resolved.
> A scenario whose elements it cannot find is quarantined with a reason instead of
> shipped as a test that would be red forever."

If a scenario is quarantined, read the reason aloud. It is a feature.

## 2:40 — break the application, while it is watching

Tab 2, between GENERATE and EXECUTE. Flip **both** switches.

| Switch | What it really does | The only correct verdict |
|---|---|---|
| Rename "Basket" to "Bag" | Renames a control. The app is perfectly healthy. | `SCRIPT_DRIFT` → heal it |
| Break order history | `GET /api/shoplite/orders` returns 500. The order still saves. | `APP_DEFECT` → **file a bug, withhold the Healer, leave it red** |

> "I have just done two different things to this application and told it nothing. One is
> a rename — the app is fine, our test is stale. The other is a real 500. A tool that
> heals everything it can heal would paper over the second one and delete the finding."

## 3:10 — the classifier earns its keep

> "`APP_DEFECT`, 0.94. It read the console error and the 500 in the network log — and
> that look was read-only by allowlist, so it cannot have fixed anything on its way past.
> The Healer is withheld and the test stays red. And here" — the other verdict —
> "`SCRIPT_DRIFT`: the control is now called 'Add to bag'. It re-proved the new locator
> and patched the test."

Show the patch diff. One line, locator only.

> "And the assertion set is diffed before and after every patch, syntactically. Delete an
> assertion, weaken a matcher, flip a negation, change an expected value — the patch is
> rejected and the test escalates to a human. On one run the Healer's own summary said it
> changed no assertions. The diff disagreed. The diff wins."

## 3:50 — the report

`/runs/<id>/report`.

Walk the brief's last Must Have in order, because it is a checklist and this is a report
that answers it line by line: **scenarios covered · pass/fail · healer actions · coverage
gaps · untested flow risk.**

Stop on the risk ledger.

> "This is the part nobody builds. Coverage is *measured*, not asserted — a route counts
> as exercised when a test that actually ran contains that path, and the table prints
> which signal made each attribution so a weak one looks weak. That produces three states,
> and the middle one is the point: **planned-only** — the plan covers it, and no test ever
> ran. Intent without evidence, which is worse than a surface nobody thought of.
>
> Each one is scored by a published weight table. Credentials 22, money 20, destructive
> 18, named in your PRD 18, planned and never run 18. The model may adjust a score by
> ±15 — and an adjustment that cites nothing the factors missed is discarded, not damped.
> None of that arithmetic needs a model, so the ledger is real even with no API key."

Then the PRD trace.

> "Every requirement in the PRD, mapped to the scenario that covers it, resolved through
> what the run actually did. `proven` means a test ran and passed. `planned-only` means
> the plan covers it and nothing ran — reported as *not covered*, because the naive
> version of this feature ticks that row and tells a team their PRD is covered about a
> flow nothing ever loaded. And every requirement carries a verbatim quote, so you can
> check the extraction against the document in ten seconds."

## 4:20 — close

> "One URL in. A suite whose every selector was proven, a bug we refused to heal, a patch
> we rejected for weakening an assertion, and an honest account of what we did not test
> and what that is worth. No human between any two of those stages.
>
> `report.md` is written beside `report.json`, so this is a pull request, not a
> screenshot."

---

## If something goes wrong on stage

| It happens | Say this, do this |
|---|---|
| A scenario is quarantined | Read the reason. It is the product working. |
| Every scenario is quarantined | It re-plans against the quarantine reasons — that is the outer loop in the diagram. Let it. |
| The run stalls in `generate` | It is one agent per scenario against a live browser. `pnpm run:tail <id>` shows the tool calls. |
| Wifi dies | Everything except the model calls is local. Show a finished run under `/runs` — the report is a file on disk. |
| No API key at all | `pnpm demo:reset && pnpm dev` with no key: the pipeline still runs end to end on deterministic stand-ins, and the coverage map and risk ledger are still genuinely computed. |
| The budget ceiling trips | It stops and says so, in the Decision Log, with the arithmetic. That is the feature. |

## Recording the video

- 1440×900, browser only. The console is dark; the ShopLite target is light. That contrast
  is deliberate — it must be obvious at a glance which application is which.
- Keep the run's own Chrome window visible during Recon and Execute. Watching it hunt for
  a locator is what makes the claim legible.
- Cut the two long waits (generation, execution). Say the elapsed time out loud instead of
  hiding it: 8–12 minutes and about $0.35 is the honest number, and it is a good one.
