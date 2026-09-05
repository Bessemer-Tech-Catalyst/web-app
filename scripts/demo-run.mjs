#!/usr/bin/env node
/**
 * Start a run from the terminal, with the demo's inputs already filled in.
 *
 * The console at /new does the same job with a form. This exists because a demo should
 * never depend on a person typing a JSON body correctly while thirty people watch, and
 * because it prints the run id and the two URLs worth having open before the first
 * stage finishes.
 *
 *   pnpm demo:run                                   # ShopLite, PRD, intent, defaults
 *   pnpm demo:run --url https://example.com         # any other target
 *   pnpm demo:run --no-prd --scenarios 3 --budget 0.75
 *   pnpm demo:run --intent "focus on checkout"
 */
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = value("port", "3002");
const url = value("url", `http://localhost:${port}/shoplite`);
const isShopLite = url.includes("/shoplite");

const body = {
  url,
  intent: value("intent", "Focus on checkout and authentication flows."),
  options: {
    maxScenarios: Number(value("scenarios", 4)),
    maxReplans: Number(value("replans", 2)),
    maxHealAttemptsPerTest: Number(value("heals", 2)),
    parallelWorkers: Number(value("workers", 4)),
    budgetUsd: Number(value("budget", 1.5)),
  },
};

// ShopLite publishes its one account in the README; anything else has to be told.
if (isShopLite && !has("no-credentials")) {
  body.credentials = { username: "ada@shoplite.test", password: "lovelace" };
} else if (value("username", null)) {
  body.credentials = { username: value("username"), password: value("password", "") };
}

if (!has("no-prd")) {
  const prdPath = value("prd", "docs/shoplite-prd.md");
  try {
    body.prd = { filename: prdPath.split("/").pop(), text: await readFile(prdPath, "utf8") };
  } catch {
    console.warn(`(no PRD at ${prdPath} — running without one)`);
  }
}

const response = await fetch(`http://localhost:${port}/api/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}).catch((err) => {
  console.error(`Could not reach The Odyssey on :${port} — is \`pnpm dev --port ${port}\` up? (${err.message})`);
  process.exit(1);
});

if (!response.ok) {
  console.error(`${response.status}: ${await response.text()}`);
  process.exit(1);
}

const { id } = await response.json();
console.log(`run       ${id}`);
console.log(`target    ${url}`);
console.log(`inputs    ${body.prd ? "PRD" : "no PRD"} · ${body.credentials ? "credentials" : "anonymous"} · ${body.options.maxScenarios} scenarios · $${body.options.budgetUsd} ceiling`);
console.log(`console   http://localhost:${port}/runs/${id}`);
console.log(`report    http://localhost:${port}/runs/${id}/report`);
console.log(`tail      pnpm run:tail ${id}`);
