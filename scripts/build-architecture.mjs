#!/usr/bin/env node
/**
 * Builds docs/architecture.svg — the submission's architecture diagram.
 *
 *   node scripts/build-architecture.mjs docs/architecture.svg
 *
 * Hand-placed rather than generated from the FSM, because the diagram's job is to be read
 * by a person in ten seconds and a faithful auto-layout of `orchestrator/run.ts` is not
 * that. It is a script rather than a checked-in blob so that a stage added to the pipeline
 * has one obvious place to be added to the picture as well.
 *
 * Light on purpose: the console is dark, and a light diagram reads on a dark slide, a
 * white README, and a printed page. No dependencies.
 */

import { writeFileSync } from "node:fs";

const W = 1320, H = 1180;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const out = [];

const INK = "#141414", MUTED = "#5f5b54", LINE = "#c9c2b6", PAPER = "#faf8f5";
const STAR = "#3f2fd4", DANGER = "#a3231a", GOOD = "#1f6b3a";

function box({ x, y, w, h, title, lines = [], accent = INK, fill = "#ffffff", dash, titleSize = 15 }) {
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${accent}" stroke-width="${dash ? 1.2 : 1.6}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
  out.push(`<text x="${x + 16}" y="${y + 26}" font-size="${titleSize}" font-weight="700" fill="${accent}" letter-spacing="0.04em">${esc(title)}</text>`);
  lines.forEach((l, i) => {
    out.push(`<text x="${x + 16}" y="${y + 47 + i * 17}" font-size="12.5" fill="${MUTED}">${esc(l)}</text>`);
  });
}

function hex({ x, y, w, h, title, lines = [], accent = STAR }) {
  const c = 18;
  out.push(`<path d="M${x + c} ${y} H${x + w - c} L${x + w} ${y + h / 2} L${x + w - c} ${y + h} H${x + c} L${x} ${y + h / 2} Z" fill="#f4f2ff" stroke="${accent}" stroke-width="2"/>`);
  out.push(`<text x="${x + 30}" y="${y + 27}" font-size="15" font-weight="700" fill="${accent}" letter-spacing="0.04em">${esc(title)}</text>`);
  lines.forEach((l, i) => out.push(`<text x="${x + 30}" y="${y + 48 + i * 17}" font-size="12.5" fill="${MUTED}">${esc(l)}</text>`));
}

function arrow(x1, y1, x2, y2, { label, dash, color = INK, mid, labelDx = 6, labelDy = -6 } = {}) {
  const d = mid ? `M${x1} ${y1} ${mid} ${x2} ${y2}` : `M${x1} ${y1} L${x2} ${y2}`;
  out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#a-${color.replace("#", "")})"/>`);
  if (label) {
    const lx = (x1 + x2) / 2 + labelDx, ly = (y1 + y2) / 2 + labelDy;
    out.push(`<text x="${lx}" y="${ly}" font-size="11.5" fill="${color}" font-weight="600">${esc(label)}</text>`);
  }
}

const markers = [INK, STAR, DANGER, GOOD, MUTED, LINE]
  .map((c) => `<marker id="a-${c.replace("#", "")}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`)
  .join("");

out.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);

// ---- title ------------------------------------------------------------------
out.push(`<text x="40" y="46" font-size="23" font-weight="800" fill="${INK}" letter-spacing="-0.01em">The Odyssey — autonomous test orchestration</text>`);
out.push(`<text x="40" y="70" font-size="13.5" fill="${MUTED}">One durable state machine per run. No human between any two stages. ★ marks a judgment the orchestrator makes and shows its working for.</text>`);

// ---- input ------------------------------------------------------------------
box({ x: 40, y: 84, w: 380, h: 74, title: "INPUT", lines: ["URL — the only required input", "optional: credentials · PRD · one sentence of intent"] });

// ---- MCP (left rail) --------------------------------------------------------
box({ x: 40, y: 300, w: 210, h: 168, title: "PLAYWRIGHT MCP", accent: MUTED, dash: "4 3", fill: "#ffffff",
  lines: ["Accessibility tree, not vision", "— deterministic, ~10× cheaper.", "", "Read-only by allowlist for the", "classifier: it may look, never", "click."] });

// ---- spine ------------------------------------------------------------------
const SX = 330, SW = 300;
box({ x: SX, y: 180, w: SW, h: 66, title: "RECON", lines: ["signs in unaided · crawls · maps every surface"] });
box({ x: SX, y: 286, w: SW, h: 66, title: "PLAN", lines: ["human-readable scenarios, not just happy paths"] });
hex({ x: SX, y: 392, w: SW, h: 86, title: "CRITIQUE ★", lines: ["scores its own plan 0–100 on six dimensions", "against what Recon actually observed"] });
box({ x: SX, y: 518, w: SW, h: 66, title: "GENERATE", lines: ["every locator proved on the live page, or quarantined"] });
box({ x: SX, y: 624, w: SW, h: 66, title: "EXECUTE", lines: ["real @playwright/test, parallel workers"] });
hex({ x: SX, y: 730, w: SW, h: 86, title: "TRIAGE ★", lines: ["broken test, or broken app?", "rule prior + read-only live look"] });

out.push(`<path d="M230 158 L230 170 L${SX + SW / 2} 170 L${SX + SW / 2} 180" fill="none" stroke="${INK}" stroke-width="1.5" marker-end="url(#a-${INK.replace("#", "")})"/>`);
arrow(SX + SW / 2, 246, SX + SW / 2, 286);
arrow(SX + SW / 2, 352, SX + SW / 2, 392);
arrow(SX + SW / 2, 478, SX + SW / 2, 518, { label: "pass", labelDx: 10, labelDy: 4, color: GOOD });
arrow(SX + SW / 2, 584, SX + SW / 2, 624);
arrow(SX + SW / 2, 690, SX + SW / 2, 730);

// critique → replan loop, on the free right-hand side
out.push(`<path d="M${SX + SW} 435 L${SX + SW + 60} 435 L${SX + SW + 60} 319 L${SX + SW} 319" fill="none" stroke="${STAR}" stroke-width="1.5" marker-end="url(#a-${STAR.replace("#", "")})"/>`);
out.push(`<text x="${SX + SW + 74}" y="372" font-size="12" font-weight="700" fill="${STAR}">score &lt; 75 and budget left</text>`);
out.push(`<text x="${SX + SW + 74}" y="390" font-size="12" fill="${MUTED}">→ re-plan against the gaps it just named</text>`);

// MCP dotted taps
for (const y of [213, 551, 773]) arrow(250, 384, SX - 4, y, { dash: "3 3", color: MUTED, mid: `L${292} 384 L${292} ${y} L` });
out.push(`<text x="40" y="492" font-size="11.5" fill="${MUTED}">tapped by recon, generate,</text>`);
out.push(`<text x="40" y="508" font-size="11.5" fill="${MUTED}">triage and heal</text>`);

// ---- triage outcomes (right) ------------------------------------------------
const RX = 710, RW = 330, BUS = 1072;
hex({ x: RX, y: 592, w: RW, h: 86, title: "SCRIPT_DRIFT → HEAL ★", accent: STAR,
  lines: ["assertion guard: delete, weaken, negate or", "re-value an assertion → patch rejected"] });
box({ x: RX, y: 700, w: RW, h: 50, title: "ENV_FLAKE → RETRY once", accent: MUTED, titleSize: 14 });
box({ x: RX, y: 772, w: RW, h: 66, title: "APP_DEFECT → BUG LEDGER", accent: DANGER, titleSize: 14,
  lines: ["Healer withheld. The test stays red."] });
box({ x: RX, y: 860, w: RW, h: 50, title: "PLAN_ERROR → PLANNER BACKLOG", accent: MUTED, titleSize: 14 });

arrow(SX + SW, 760, RX, 635, { color: STAR, mid: `L${670} 760 L${670} 635 L` });
arrow(SX + SW, 773, RX, 725, { color: MUTED, mid: `L${670} 773 L${670} 725 L` });
arrow(SX + SW, 786, RX, 805, { color: DANGER, mid: `L${670} 786 L${670} 805 L` });
arrow(SX + SW, 799, RX, 885, { color: MUTED, mid: `L${670} 799 L${670} 885 L` });

// heal → re-run the one test
box({ x: RX + 36, y: 500, w: RW - 72, h: 46, title: "RE-RUN THAT ONE TEST", accent: GOOD, titleSize: 13 });
arrow(RX + RW / 2, 592, RX + RW / 2, 546, { color: GOOD });

// every outcome joins one bus into the report
const line = (d, color = MUTED) => out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/>`);
line(`M${RX + RW - 36} 523 L${BUS} 523`, GOOD);
line(`M${RX + RW} 635 L${BUS} 635`, STAR);
line(`M${RX + RW} 725 L${BUS} 725`);
line(`M${RX + RW} 805 L${BUS} 805`, DANGER);
line(`M${RX + RW} 885 L${BUS} 885`);
arrow(BUS, 523, 750, 953, { mid: `L${BUS} 953 L` });

// ---- report -----------------------------------------------------------------
hex({ x: 330, y: 916, w: 420, h: 74, title: "REPORT ★", lines: ["scenarios covered · pass/fail · healer actions ·", "gaps remaining · untested flow risk"] });
arrow(SX + SW / 2, 816, 540, 916);

box({ x: 40, y: 1030, w: 300, h: 84, title: "COVERAGE MAP", accent: INK,
  lines: ["read off the emitted suite, not the plan:", "navigation › control › scenario-text › none"] });
hex({ x: 360, y: 1030, w: 300, h: 84, title: "RISK LEDGER ★", lines: ["published weight table · model may", "adjust ±15 or is discarded"] });
hex({ x: 680, y: 1030, w: 300, h: 84, title: "PRD TRACE ★", lines: ["proven · exercised · planned-only ·", "uncovered — with verbatim quotes"] });
arrow(430, 990, 190, 1030, { mid: `L${430} 1010 L${190} 1010 L` });
arrow(520, 990, 510, 1030);
arrow(640, 990, 830, 1030, { mid: `L${640} 1010 L${830} 1010 L` });

box({ x: 1000, y: 1030, w: 280, h: 84, title: "WORKSPACE ON DISK", accent: MUTED,
  lines: ["tests/*.spec.ts · report.json · report.md", "traces · patches · coverage · risk · trace"] });
arrow(980, 1072, 1000, 1072);

// ---- event log --------------------------------------------------------------
box({ x: 1085, y: 180, w: 225, h: 300, title: "events.ndjson", accent: GOOD,
  lines: ["Every transition emits a", "decision event carrying its", "rationale, its confidence and", "the evidence it cites.", "", "→ SSE → live Decision Log", "", "That append-only file is the", "database, the crash-recovery", "story, the replay mechanism", "and the demo."] });
out.push(`<path d="M${SX + SW} 213 L1064 213 L1064 300 L1085 300" fill="none" stroke="${GOOD}" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#a-${GOOD.replace("#", "")})"/>`);
out.push(`<text x="890" y="206" font-size="11" fill="${GOOD}" font-weight="600">every transition</text>`);

// ---- frame ------------------------------------------------------------------
out.push(`<rect x="300" y="150" width="755" height="860" rx="14" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
out.push(`<text x="770" y="176" font-size="11.5" fill="${MUTED}" font-weight="700" letter-spacing="0.08em">ORCHESTRATOR — ONE DURABLE STATE MACHINE PER RUN</text>`);

writeFileSync(process.argv[2], `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"><defs>${markers}</defs>${out.join("")}</svg>\n`);
console.log("written");
