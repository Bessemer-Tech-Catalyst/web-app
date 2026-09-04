/**
 * The basket. Kept in `sessionStorage`, and that is the interesting part.
 *
 * Playwright's `storageState` — which is how this pipeline hands a signed-in session
 * from the agents to the generated suite — carries cookies and `localStorage`. It does
 * not carry `sessionStorage`. So the suite inherits ShopLite's login and none of the
 * items the Generator put in a basket while it was proving locators, and the first test
 * to open the basket sees an empty one rather than the agent's shopping.
 *
 * That is the concrete answer to the open finding in PLAN.md — a suite inheriting the
 * agents' own side effects as fixture data. It is not a fix for the general case, and it
 * is not pretended to be: it is what an application that does not have the problem looks
 * like, which is worth being able to point at.
 */

"use client";

export interface BasketLine {
  sku: string;
  qty: number;
}

const KEY = "shoplite.basket";

export function readBasket(): BasketLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as BasketLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.sku === "string") : [];
  } catch {
    // A browser with storage blocked gets an empty basket rather than a broken page.
    return [];
  }
}

export function writeBasket(lines: BasketLine[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(lines));
    // Storage events do not fire in the tab that wrote them, so the app's own listeners
    // need this. It is what keeps the header count and the basket page in step.
    window.dispatchEvent(new CustomEvent("shoplite:basket"));
  } catch {
    /* nothing to do; the basket simply does not persist */
  }
}

export function addToBasket(sku: string): BasketLine[] {
  const lines = readBasket();
  const existing = lines.find((l) => l.sku === sku);
  if (existing) existing.qty = Math.min(9, existing.qty + 1);
  else lines.push({ sku, qty: 1 });
  writeBasket(lines);
  return lines;
}

export function setQty(sku: string, qty: number): BasketLine[] {
  const lines = readBasket()
    .map((l) => (l.sku === sku ? { ...l, qty: Math.max(0, Math.min(9, qty)) } : l))
    .filter((l) => l.qty > 0);
  writeBasket(lines);
  return lines;
}

export function clearBasket(): void {
  writeBasket([]);
}
