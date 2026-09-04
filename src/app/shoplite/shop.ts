/**
 * ShopLite — the demo target. Its catalogue, its session, and what the two deliberate
 * defects are for. The state behind them lives in `shop-state.ts`, which this file must
 * not import: everything here is reachable from a client component.
 *
 * This is the application The Odyssey is pointed at on stage, and it exists for one
 * reason the public demo apps cannot serve: **we need to be able to break it on command,
 * in two specific ways, while the judges watch.**
 *
 *   `drift`  renames a button. Nothing is wrong with the application; a locator that was
 *            proven twenty minutes ago no longer resolves. The correct pipeline
 *            behaviour is SCRIPT_DRIFT → the Healer re-proves the control and patches
 *            the test.
 *   `defect` makes the order history endpoint return 500. The application is genuinely
 *            broken. The correct behaviour is APP_DEFECT → a bug is filed, the Healer is
 *            withheld, and the test stays red. Healing this would delete the finding.
 *
 * Both are observable by the classifier without touching anything: the renamed control
 * is in the accessibility snapshot, and the 500 is in the network log of a plain page
 * load. That is deliberate — the classifier is read-only by allowlist, so a defect it
 * could only reach by clicking would be a defect it could not classify.
 *
 * One design choice worth naming, because it routes around a known finding rather than
 * hiding it: **the cart lives in `sessionStorage`, the session in a cookie.** Playwright's
 * `storageState` carries cookies and `localStorage`, so the suite inherits the login and
 * *not* the cart the agents filled while exploring. That is the one concrete answer we
 * have to "the storage-state hand-off carries the agents' own side effects into the
 * suite" (PLAN.md, open items) — it does not resolve the general problem, it shows what
 * an application that does not suffer from it looks like.
 */

export interface Flags {
  /** Renames the catalogue's add button. A healthy app the test no longer matches. */
  drift: boolean;
  /** Order history returns 500. A broken app the test is right to fail against. */
  defect: boolean;
}

export const NO_FLAGS: Flags = { drift: false, defect: false };

export const SESSION_COOKIE = "shoplite_session";

/** The one account. Published in the README — this app holds nothing worth guarding. */
export const DEMO_USER = { email: "ada@shoplite.test", password: "lovelace" };

export interface Product {
  id: string;
  name: string;
  /** Whole pence, so no test ever fails on a floating-point total. */
  pence: number;
  blurb: string;
}

export const CATALOGUE: Product[] = [
  { id: "sku-kettle", name: "Copper stovetop kettle", pence: 4200, blurb: "Two litres, whistles at the boil." },
  { id: "sku-grinder", name: "Hand burr grinder", pence: 5800, blurb: "Stepped ceramic burrs, forty clicks." },
  { id: "sku-scale", name: "Bench scale, 0.1g", pence: 2400, blurb: "Tares in under a second." },
  { id: "sku-filters", name: "Paper filters (100)", pence: 900, blurb: "Bleached, size 02." },
];

export const priceOf = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export interface Order {
  id: string;
  placedAt: string;
  email: string;
  lines: { sku: string; name: string; qty: number; pence: number }[];
  totalPence: number;
}
