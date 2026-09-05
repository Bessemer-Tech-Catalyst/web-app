#!/usr/bin/env node
/**
 * Put ShopLite back to a known state between demo runs.
 *
 * A demo that starts from whatever the last run left behind is a demo that argues with
 * itself on stage. This clears the order history and sets the two defect switches
 * explicitly, so "healthy" means the same thing every time.
 *
 *   node scripts/demo-reset.mjs                  # healthy: both switches off, no orders
 *   node scripts/demo-reset.mjs --drift          # rename the basket control (SCRIPT_DRIFT)
 *   node scripts/demo-reset.mjs --defect         # 500 the order history (APP_DEFECT)
 *   node scripts/demo-reset.mjs --drift --defect --keep-orders
 *
 * `--port` (default 3002) is the port `pnpm dev` is serving on.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = value("port", "3002");
const flags = { drift: has("drift"), defect: has("defect") };

if (!has("keep-orders")) {
  const dataDir = process.env.ODYSSEY_DATA_DIR ?? join(process.cwd(), ".odyssey");
  await rm(join(dataDir, "shoplite-orders.json"), { force: true });
  console.log("orders   cleared");
}

const response = await fetch(`http://localhost:${port}/api/shoplite/flags`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(flags),
}).catch((err) => {
  console.error(`Could not reach ShopLite on :${port} — is \`pnpm dev --port ${port}\` up? (${err.message})`);
  process.exit(1);
});

if (!response.ok) {
  console.error(`ShopLite answered ${response.status} setting the flags.`);
  process.exit(1);
}
const now = await response.json();
console.log(`drift    ${now.drift ? "ON  — the basket control is renamed (expect SCRIPT_DRIFT)" : "off"}`);
console.log(`defect   ${now.defect ? "ON  — order history returns 500 (expect APP_DEFECT)" : "off"}`);
