#!/usr/bin/env node
/**
 * Builds the submission deck — docs/the-odyssey-deck.pptx.
 *
 * Kept in the repo so the deck is reproducible rather than a binary somebody once made,
 * but its two dependencies are deliberately NOT in package.json: neither has anything to
 * do with running the product, and a hackathon judge cloning this repo should not wait on
 * a native image library to start a test run.
 *
 *   npm i --no-save pptxgenjs sharp
 *   node scripts/build-deck.mjs docs/the-odyssey-deck.pptx docs/architecture.svg
 *
 * The palette below is the console's own, converted from the oklch tokens in
 * `src/app/globals.css`, so the deck and the product cannot drift apart by accident.
 *
 * ONLY=<n> builds a one-slide deck out of slide n. That exists because the only renderer
 * available on the machine this was written on previews the first slide of a file and no
 * others, and a deck nobody has looked at is a deck with text hanging off the edge of it.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const sharp = require("sharp");

const OUT = process.argv[2] ?? "docs/the-odyssey-deck.pptx";
const ARCH = process.argv[3] ?? "docs/architecture.svg";

/** The architecture diagram, rasterised — pptx cannot embed the SVG the repo ships. */
const archPng = existsSync(ARCH)
  ? ARCH.endsWith(".svg")
    ? await sharp(ARCH, { density: 200 }).resize(2640).png().toBuffer()
    : readFileSync(ARCH)
  : null;

// --- palette: the product's own, converted from its oklch tokens -------------
const INK = "090A0E", CARD = "16181D", CARD2 = "1E2026", LINE = "2F3239";
const DIM = "8F949D", MID = "B2B6BE", TEXT = "D1D4D9", BRIGHT = "EBEDF0";
const EMBER = "F06504", EMBER_L = "FD8F37", OK = "5BD390", DANGER = "FF6A6C", VIOLET = "A376E9", WARN = "ECA929";

const HEAD = "Cambria";          // safe-list serif, ships with Office
const BODY = "Calibri";          // safe-list sans
const MONO = "Courier New";

const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE";     // 13.3 x 7.5
pres.author = "The Odyssey";
pres.title = "The Odyssey — autonomous test orchestration";

const W = 13.3, H = 7.5, M = 0.7;

// Visual QA only renders the *first* slide of a deck in this environment, so ONLY=n
// builds a one-slide deck out of slide n. Every other slide becomes a sink.
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : null;
let slideNo = 0;
const SINK = new Proxy({}, { get: (_, k) => (k === "background" ? undefined : () => SINK), set: () => true });
function slide({ dark = true } = {}) {
  slideNo++;
  if (ONLY && slideNo !== ONLY) return SINK;
  const s = pres.addSlide();
  s.background = { color: dark ? INK : BRIGHT };
  return s;
}

function title(s, text, { color = BRIGHT, y = 0.55, size = 34, w = W - 2 * M } = {}) {
  s.addText(text, {
    x: M, y, w, h: 0.95, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: size, bold: true, color, align: "left",
  });
}

function kicker(s, text, { color = EMBER, y = 0.3 } = {}) {
  s.addText(text.toUpperCase(), {
    x: M, y, w: W - 2 * M, h: 0.25, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 11, bold: true, color, charSpacing: 2,
  });
}

function card(s, { x, y, w, h, fill = CARD, line = LINE }) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: fill }, line: { color: line, width: 1 },
  });
}

function body(s, text, o) {
  s.addText(text, {
    isTextBox: true, margin: 0, fontFace: BODY, fontSize: 14, color: TEXT,
    lineSpacingMultiple: 1.15, valign: "top", ...o,
  });
}

// ---------------------------------------------------------------- 1. title --
{
  const s = slide();
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: INK } });
  s.addShape(pres.ShapeType.ellipse, {
    x: 8.4, y: -2.6, w: 8.2, h: 8.2, fill: { color: EMBER, transparency: 88 }, line: { color: EMBER, transparency: 92 },
  });
  s.addText("BESSEMER TECH CATALYST  ·  AI / ML TRACK", {
    x: M, y: 1.5, w: 9, h: 0.3, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, bold: true, color: EMBER, charSpacing: 2,
  });
  s.addText("The Odyssey", {
    x: M, y: 2.0, w: 10, h: 1.3, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 66, bold: true, color: BRIGHT,
  });
  s.addText("An autonomous test orchestration agent.", {
    x: M, y: 3.3, w: 10.5, h: 0.5, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 25, color: EMBER_L, italic: true,
  });
  body(s,
    "Give it a URL. It explores the application, writes a test plan, grades its own plan, generates real " +
    "Playwright tests whose every selector it proved on the live page, runs them, works out whether each " +
    "failure is a broken test or a broken app, repairs the broken tests, refuses to repair the broken app, " +
    "and reports what it did not test — and what that is worth.",
    { x: M, y: 4.1, w: 8.9, h: 1.5, fontSize: 15, color: MID });
  s.addText("No human between any two of those stages.", {
    x: M, y: 5.55, w: 9, h: 0.4, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 17, bold: true, color: BRIGHT,
  });
  s.addText("Autonomous Test Orchestration Agent  ·  Problem statement by Aivar Innovations", {
    x: M, y: 6.6, w: 11, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 11, color: DIM,
  });
  s.addNotes("One URL in, a working test suite and an honest report out. The sub-agents are table stakes; the orchestrator is the product.");
}

// -------------------------------------------------------------- 2. problem --
{
  const s = slide();
  kicker(s, "the problem");
  title(s, "Testing's cost is not execution. It is decision-making.");
  body(s,
    "Figuring out what to test. Judging whether the right things were tested. Knowing whether a red test " +
    "means a broken application or a broken script. Those three judgments are what a team pays a QA " +
    "engineer for, and they are the three an AI testing tool hands straight back.",
    { x: M, y: 1.5, w: 7.4, h: 1.5, fontSize: 15, color: MID });

  const items = [
    ["What to test", "Coverage is decided by whoever has time, and nobody measures what was left out.", EMBER],
    ["Was it enough?", "A plan is approved by the person who wrote it, against no stated bar.", VIOLET],
    ["Red — but why?", "Every failure costs a human triage before anyone knows if it is a bug.", DANGER],
  ];
  items.forEach(([h, p, c], i) => {
    const y = 3.25 + i * 1.32;
    card(s, { x: M, y, w: 7.4, h: 1.15 });
    s.addShape(pres.ShapeType.ellipse, { x: M + 0.3, y: y + 0.38, w: 0.4, h: 0.4, fill: { color: c }, line: { color: c } });
    s.addText(String(i + 1), { x: M + 0.3, y: y + 0.38, w: 0.4, h: 0.4, isTextBox: true, margin: 0, align: "center", valign: "middle", fontFace: BODY, fontSize: 13, bold: true, color: INK });
    s.addText(h, { x: M + 0.92, y: y + 0.2, w: 6.2, h: 0.32, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 15, bold: true, color: BRIGHT });
    body(s, p, { x: M + 0.92, y: y + 0.56, w: 6.2, h: 0.5, fontSize: 12.5, color: DIM });
  });

  card(s, { x: 8.5, y: 1.5, w: 4.1, h: 5.05, fill: CARD2 });
  s.addText("FROM THE BRIEF", { x: 8.8, y: 1.8, w: 3.5, h: 0.25, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: EMBER, charSpacing: 1.5 });
  body(s,
    "“The core problem is not execution — it is decision-making: figuring out what to test, evaluating " +
    "whether the right things were tested, and knowing when a failure reflects a real defect versus a " +
    "broken script.”",
    { x: 8.8, y: 2.2, w: 3.5, h: 1.8, fontSize: 14, color: TEXT, italic: true });
  body(s,
    "“What they do not do is orchestrate these capabilities end to end — deciding when to plan, when to " +
    "generate, when to heal, and when to escalate — without a human directing each step.”",
    { x: 8.8, y: 4.1, w: 3.5, h: 1.7, fontSize: 14, color: TEXT, italic: true });
  s.addText("— the problem statement, §1 and §2", {
    x: 8.8, y: 6.05, w: 3.5, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 11, color: DIM });
  s.addNotes("The brief itself says the gap is orchestration, not the sub-agents.");
}

// ------------------------------------------------------- 3. what exists ----
{
  const s = slide();
  kicker(s, "why this is not solved already");
  title(s, "Playwright already ships all three");
  body(s,
    "npx playwright init-agents installs a Planner, a Generator and a Healer today. The brief names those " +
    "three word for word. So the sub-agents are table stakes — and Playwright's own documentation tells you " +
    "what to do with them:",
    { x: M, y: 1.5, w: 11.9, h: 0.9, fontSize: 15, color: MID });

  const gates = [
    ["after PLAN", "a human reviews the plan"],
    ["after GENERATE", "a human reviews the tests"],
    ["after HEAL", "a human reviews the patch"],
  ];
  gates.forEach(([h, p], i) => {
    const x = M + i * 4.03;
    card(s, { x, y: 2.75, w: 3.75, h: 1.35, fill: CARD, line: DANGER });
    s.addText(h, { x: x + 0.25, y: 2.95, w: 3.3, h: 0.32, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 13, bold: true, color: DANGER });
    body(s, p, { x: x + 0.25, y: 3.32, w: 3.3, h: 0.6, fontSize: 13, color: MID });
    s.addText("HUMAN GATE", { x: x + 0.25, y: 3.75, w: 3.3, h: 0.25, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: DANGER, charSpacing: 1.5 });
  });

  card(s, { x: M, y: 4.45, w: 11.9, h: 2.15, fill: CARD2, line: EMBER });
  s.addText("The Odyssey deletes those three humans and replaces them with machine judgment that shows its working.", {
    x: M + 0.4, y: 4.72, w: 11.1, h: 0.85, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 20, bold: true, color: BRIGHT, lineSpacingMultiple: 1.1,
  });
  body(s,
    "Four decisions the pipeline makes on its own: whether its plan is good enough, whether a plan that cannot " +
    "be built should be re-planned, whether a failure is the application's fault, and whether a proposed patch " +
    "is honest. Each one emits its rationale, its confidence and the evidence it cites.",
    { x: M + 0.4, y: 5.6, w: 11.1, h: 0.9, fontSize: 13.5, color: MID });
  s.addNotes("Anyone can wire three agents in a row. The judgment between them is the product.");
}

// --------------------------------------------------------- 4. architecture --
{
  const s = slide();
  kicker(s, "architecture");
  title(s, "One durable state machine per run", { y: 0.52 });
  if (archPng) {
    const data = "image/png;base64," + archPng.toString("base64");
    const h = 5.75, w = h * (1320 / 1180);   // 1320 x 1180 source, height-bound
    s.addImage({ data, x: 3.55, y: 1.5, w, h, rounding: false });
  } else {
    body(s, "docs/architecture.svg", { x: M, y: 3, w: 6, h: 0.5 });
  }
  const notes = [
    ["★", "A judgment, not a step. Each emits its rationale, its confidence and the evidence it cites.", VIOLET],
    ["↺", "Two re-plan loops: one when the plan scores badly, one when it cannot be built at all.", EMBER_L],
    ["MCP", "Accessibility tree, not vision. Deterministic and about ten times cheaper.", OK],
  ];
  notes.forEach(([k, v, c], i) => {
    const y = 1.75 + i * 1.75;
    s.addText(k, { x: M, y, w: 2.5, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 15, bold: true, color: c });
    body(s, v, { x: M, y: y + 0.36, w: 2.55, h: 1.2, fontSize: 12.5, color: DIM });
  });
  const right = [
    ["APP_DEFECT", "never reaches the Healer. The bug is filed and the test stays red.", DANGER],
    ["Coverage", "is read off the emitted suite, never off the plan's word for it.", OK],
    ["events.ndjson", "is the database, the crash-recovery story and the live console.", EMBER_L],
  ];
  right.forEach(([k, v, c], i) => {
    const y = 1.75 + i * 1.75;
    s.addText(k, { x: 10.15, y, w: 2.45, h: 0.3, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 13, bold: true, color: c });
    body(s, v, { x: 10.15, y: y + 0.36, w: 2.45, h: 1.2, fontSize: 12.5, color: DIM });
  });
  s.addNotes("Recon, Plan, Critique, Generate, Execute, Triage, Heal, Report. The starred stages are the judgments. Every transition is appended to one event log, which is the database, the crash recovery story, the replay mechanism and the live console.");
}

// ------------------------------------------------------- 5. four judgments --
{
  const s = slide();
  kicker(s, "the approach");
  title(s, "Four judgments, and none of them is a prompt");
  const j = [
    ["It grades its own plan", "Six dimensions, scored 0–100 against what Recon actually observed. Below 75 it rejects its own plan and re-plans against the gaps it named. Live: 62 → seven gaps → 82.", VIOLET],
    ["It will not write a selector it has not proven", "A ledger of every locator Playwright itself resolved this session, checked mechanically against the emitted file. Unprovable scenarios are quarantined with a reason.", EMBER],
    ["It knows a broken test from a broken app", "A rule prior from Playwright's error text and the locator ledger, then a read-only live look — console errors, 5xx, is the control there under a new name.", DANGER],
    ["The Healer is not allowed to cheat", "The assertion set is diffed before and after every patch. Delete, weaken, negate or re-value one and the patch is rejected and the test escalates.", OK],
  ];
  j.forEach(([h, p, c], i) => {
    const x = M + (i % 2) * 6.15, y = 1.55 + Math.floor(i / 2) * 2.55;
    card(s, { x, y, w: 5.85, h: 2.3 });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.32, y: y + 0.32, w: 0.44, h: 0.44, fill: { color: c, transparency: 78 }, line: { color: c } });
    s.addText("★", { x: x + 0.32, y: y + 0.32, w: 0.44, h: 0.44, isTextBox: true, margin: 0, align: "center", valign: "middle", fontSize: 13, color: c });
    s.addText(h, { x: x + 0.95, y: y + 0.33, w: 4.6, h: 0.6, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 15.5, bold: true, color: BRIGHT });
    body(s, p, { x: x + 0.32, y: y + 1.05, w: 5.2, h: 1.1, fontSize: 12.5, color: DIM });
  });
  body(s,
    "All four are mechanical checks rather than instructions to a model — and each has already overruled the model in a live run.",
    { x: M, y: 6.75, w: 11.9, h: 0.4, fontSize: 14, color: EMBER_L, italic: true });
  s.addNotes("Each of these is mechanical. The assertion guard has already caught a patch whose own summary claimed no assertions changed.");
}

// ---------------------------------------------------------------- 6. demo ---
{
  const s = slide();
  kicker(s, "the demo");
  title(s, "Break the app while it is watching");
  body(s,
    "ShopLite ships with the repo and has two switches. Flip one between GENERATE and EXECUTE, tell the " +
    "pipeline nothing, and watch what it decides. It is the only honest way to test a classifier.",
    { x: M, y: 1.6, w: 11.9, h: 0.8, fontSize: 15, color: MID });

  [["THE SWITCH", M + 0.35], ["THE VERDICT, UNPROMPTED", M + 5.0], ["WHAT THE ORCHESTRATOR DOES", M + 8.1]].forEach(([k, x]) => {
    s.addText(k, { x, y: 2.65, w: 3.4, h: 0.25, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: DIM, charSpacing: 1.5 });
  });

  const rows = [
    ['Rename "Basket" to "Bag"', "The control is renamed. The application is perfectly healthy.", "SCRIPT_DRIFT", "Re-prove the control, patch the test, re-run it green.", OK],
    ["Break order history", "GET /api/shoplite/orders returns 500. The order still saves.", "APP_DEFECT  0.94", "File the bug. Withhold the Healer. The test stays red.", DANGER],
  ];
  rows.forEach(([what, detail, verdict, action, c], i) => {
    const y = 3.05 + i * 1.65;
    card(s, { x: M, y, w: 11.9, h: 1.45, fill: CARD, line: c });
    s.addText(what, { x: M + 0.35, y: y + 0.22, w: 4.3, h: 0.32, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 15, bold: true, color: BRIGHT });
    body(s, detail, { x: M + 0.35, y: y + 0.62, w: 4.3, h: 0.9, fontSize: 12.5, color: DIM });
    s.addText(verdict, { x: M + 5.0, y: y + 0.28, w: 2.9, h: 0.35, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 14, bold: true, color: c });
    body(s, action, { x: M + 8.1, y: y + 0.3, w: 3.4, h: 1.0, fontSize: 13, color: TEXT });
  });

  body(s,
    "A tool that heals everything it can heal papers over the second one and deletes the finding.",
    { x: M, y: 6.55, w: 11.9, h: 0.4, fontSize: 14, color: EMBER_L, italic: true });
  s.addNotes("run_8b37144b did exactly this with no human in between, and had a third patch rejected by the assertion guard.");
}

// ------------------------------------------------------------- 7. measured --
{
  const s = slide();
  kicker(s, "what makes the report trustworthy");
  title(s, "Measured, not asserted");
  body(s,
    "A route counts as exercised when a test that actually ran contains that path. The report prints which " +
    "signal made each attribution, so a weak claim looks weak — and that produces a third state between " +
    "covered and uncovered.",
    { x: M, y: 1.45, w: 11.9, h: 0.8, fontSize: 15, color: MID });

  const sig = [["navigation", "the emitted code contains the path", OK], ["control", "it got there by clicking", WARN], ["scenario-text", "only the plan names it", DANGER], ["none", "nothing reached it", DIM]];
  sig.forEach(([k, v, c], i) => {
    const x = M + i * 3.0;
    card(s, { x, y: 2.45, w: 2.8, h: 1.05 });
    s.addText(k, { x: x + 0.22, y: 2.62, w: 2.4, h: 0.3, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 12.5, bold: true, color: c });
    body(s, v, { x: x + 0.22, y: 2.95, w: 2.4, h: 0.5, fontSize: 11.5, color: DIM });
  });

  card(s, { x: M, y: 3.75, w: 5.85, h: 2.6, fill: CARD2, line: VIOLET });
  s.addText("planned-only", { x: M + 0.35, y: 4.0, w: 5.1, h: 0.35, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 17, bold: true, color: VIOLET });
  body(s,
    "The plan covers this surface and no test ever ran. Intent without evidence — worse news than a surface " +
    "nobody thought of, and scored accordingly.\n\nThe naive version of this feature ticks that row and tells " +
    "a team their PRD is covered about a flow nothing ever loaded.",
    { x: M + 0.35, y: 4.45, w: 5.1, h: 2.0, fontSize: 13.5, color: TEXT });

  card(s, { x: 6.85, y: 3.75, w: 5.75, h: 2.6 });
  s.addText("PUBLISHED WEIGHT TABLE", { x: 7.15, y: 3.98, w: 5.1, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, bold: true, color: EMBER, charSpacing: 1.5 });
  const weights = [["Touches credentials or account recovery", "22"], ["Handles money or personal data", "20"], ["Destructive or privileged action", "18"], ["Named in the supplied PRD", "18"], ["The plan covered it and no test ran", "18"], ["Reachable in ≤2 segments", "12"]];
  weights.forEach(([k, v], i) => {
    const y = 4.32 + i * 0.33;
    s.addText(k, { x: 7.15, y, w: 4.5, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 12, color: TEXT });
    s.addText(v, { x: 11.7, y, w: 0.55, h: 0.3, isTextBox: true, margin: 0, align: "right", fontFace: MONO, fontSize: 12, bold: true, color: EMBER_L });
  });
  body(s,
    "The model may adjust a score by ±15 — and an adjustment citing nothing the factors missed is discarded, not damped. None of this scoring needs a model, so the ledger is real with no API key at all.",
    { x: M, y: 6.6, w: 11.9, h: 0.5, fontSize: 13.5, color: EMBER_L, italic: true });
  s.addNotes("Arithmetic anyone can recompute, calibrated by a unit test against the product's own worked example.");
}

// ---------------------------------------------------------- 8. trade-offs ---
{
  const s = slide();
  kicker(s, "trade-offs we would defend");
  title(s, "Six decisions, and what each one cost");
  const t = [
    ["Accessibility tree, not vision", "Deterministic and ~10× cheaper. Cost: a purely visual defect is invisible to it."],
    ["A visible browser, one worker", "Watching it hunt for a locator is half of what makes a run legible. Cost: parallelism, until ODYSSEY_HEADLESS=1."],
    ["Files on disk, no database", "Every artifact is where Playwright's own tooling expects it, and a run survives a crash. Cost: one run at a time."],
    ["Quarantine over volume", "Twelve proven tests and eight reasons beat forty tests of which thirty-eight are red. Cost: a smaller headline number."],
    ["Judgment in the FSM, labour in the agents", "Every branch is inspectable and unit-testable without a key. Cost: prompts cannot fix an orchestration bug."],
    ["A demo target we can break on command", "A classifier is only demonstrable against a defect you introduce deliberately. Cost: it is our app, not theirs."],
  ];
  t.forEach(([h, p], i) => {
    const x = M + (i % 2) * 6.15, y = 1.5 + Math.floor(i / 2) * 1.75;
    card(s, { x, y, w: 5.85, h: 1.5 });
    s.addText(h, { x: x + 0.3, y: y + 0.22, w: 5.25, h: 0.3, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 14.5, bold: true, color: EMBER_L });
    body(s, p, { x: x + 0.3, y: y + 0.6, w: 5.25, h: 0.8, fontSize: 12.5, color: DIM });
  });
  s.addNotes("Each of these is a real cost, and each is stated in the README rather than implied away.");
}

// ------------------------------------------------------ 9. business impact --
{
  const s = slide();
  kicker(s, "business impact");
  title(s, "What it replaces, and what it costs");
  const stats = [["$0.16 – $0.35", "a measured run against a live target, end to end"], ["8 – 12 min", "URL in, suite and report out, unattended"], ["0", "human approval gates between stages"], ["100%", "of test code produced by the pipeline"]];
  stats.forEach(([n, l], i) => {
    const x = M + i * 3.0;
    card(s, { x, y: 1.5, w: 2.8, h: 1.5, fill: CARD2 });
    s.addText(n, { x: x + 0.2, y: 1.68, w: 2.4, h: 0.6, isTextBox: true, margin: 0, fontFace: HEAD, fontSize: 27, bold: true, color: EMBER_L });
    body(s, l, { x: x + 0.2, y: 2.32, w: 2.4, h: 0.6, fontSize: 11.5, color: DIM });
  });

  card(s, { x: M, y: 3.3, w: 5.85, h: 3.3 });
  s.addText("Where the hours actually go", { x: M + 0.3, y: 3.55, w: 5.2, h: 0.35, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 16, bold: true, color: BRIGHT });
  body(s,
    "Authoring an equivalent four-scenario suite with selectors proven against a live application is most of " +
    "a day for one engineer. Keeping it green as the UI drifts is the recurring cost, and it is the one that " +
    "quietly kills suites: a locator renamed on Tuesday is a red build on Wednesday and a deleted test on " +
    "Friday.\n\nThis repairs drift automatically, refuses to repair a genuine defect, and says which it did.",
    { x: M + 0.3, y: 4.0, w: 5.25, h: 2.4, fontSize: 13, color: TEXT });

  card(s, { x: 6.85, y: 3.3, w: 5.75, h: 3.3, fill: CARD2, line: EMBER });
  s.addText("The line a QA lead cares about", { x: 7.15, y: 3.55, w: 5.15, h: 0.35, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 16, bold: true, color: BRIGHT });
  body(s,
    "“/forgot-password — 78/100, critical. Touches credentials. Named in your PRD. One segment from the " +
    "landing page. The plan covers it and no test ever ran.”",
    { x: 7.15, y: 4.0, w: 5.15, h: 1.3, fontSize: 14, color: EMBER_L, italic: true });
  body(s,
    "No coverage tool says this today. Percentage coverage tells you what you touched; it never tells you what " +
    "the gap is worth. That sentence is what turns a report into a decision about where to spend the next hour.",
    { x: 7.15, y: 5.35, w: 5.15, h: 1.1, fontSize: 13, color: TEXT });
  s.addNotes("Costs are measured from real runs in this repo, not estimated. The authoring comparison is an estimate and is stated as one.");
}

// ------------------------------------------------------------- 10. honesty --
{
  const s = slide();
  kicker(s, "what is not finished");
  title(s, "Stated, rather than implied away");
  const items = [
    ["The storage-state hand-off carries the agents' own side effects into the suite.", "If Recon creates a record while crawling, the suite starts with it present. ShopLite shows what an immune application looks like — its basket lives in sessionStorage — which routes around the problem rather than solving it."],
    ["The classifier cannot know which session the suite ran with.", "A failure caused by an unexpected storage state is harder for it to attribute than one caused by a 500."],
    ["The console's fleet pages are seeded, and say so on the page.", "Overview, Coverage, Defects, Schedule and Targets describe the product around a single run. Every number inside a run is measured by that run."],
  ];
  items.forEach(([h, p], i) => {
    const y = 1.6 + i * 1.65;
    card(s, { x: M, y, w: 11.9, h: 1.42 });
    s.addText(h, { x: M + 0.35, y: y + 0.2, w: 11.2, h: 0.32, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 15, bold: true, color: WARN });
    body(s, p, { x: M + 0.35, y: y + 0.58, w: 11.2, h: 0.7, fontSize: 13, color: DIM });
  });
  body(s,
    "This repo distinguishes “the code exists” from “a real run produced it”, and the README says which is which, stage by stage.",
    { x: M, y: 6.65, w: 11.9, h: 0.4, fontSize: 14, color: EMBER_L, italic: true });
  s.addNotes("Every phase in this repo was marked done once before it had ever run, and running it found defects each time. So the labels are earned, not assumed.");
}

// ---------------------------------------------------------------- 11. close --
{
  const s = slide();
  s.addShape(pres.ShapeType.ellipse, { x: -3.2, y: 3.6, w: 8.4, h: 8.4, fill: { color: EMBER, transparency: 90 }, line: { color: EMBER, transparency: 94 } });
  kicker(s, "in one sentence", { y: 1.5 });
  s.addText("One URL in. A suite whose every selector was proven, a bug we refused to heal, a patch we rejected for weakening an assertion, and an honest account of what we did not test.", {
    x: M, y: 2.0, w: 11.9, h: 2.2, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 30, bold: true, color: BRIGHT, lineSpacingMultiple: 1.15,
  });
  body(s, "No human between any two of those stages.", { x: M, y: 4.3, w: 11.9, h: 0.4, fontSize: 18, color: EMBER_L });
  const links = [["SUBMISSION.md", "every requirement → the file that implements it"], ["docs/DEMO.md", "the run of show, and what to say when it breaks"], ["pnpm verify", "typecheck, lint, 123 assertions, ~2 seconds"]];
  links.forEach(([k, v], i) => {
    const x = M + i * 4.03;
    card(s, { x, y: 5.2, w: 3.75, h: 1.25, fill: CARD });
    s.addText(k, { x: x + 0.25, y: 5.42, w: 3.3, h: 0.3, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 13, bold: true, color: EMBER_L });
    body(s, v, { x: x + 0.25, y: 5.78, w: 3.3, h: 0.55, fontSize: 11.5, color: DIM });
  });
  s.addNotes("Thank you. Questions.");
}

await pres.writeFile({ fileName: OUT });
console.log("wrote", OUT, "-", pres.slides?.length ?? "?", "slides");
