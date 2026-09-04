/**
 * ShopLite's state on disk — the flags and the order book.
 *
 * Split out of `shop.ts` for one hard reason: `shop.ts` is imported by client components
 * (the catalogue and the price formatter), and a module that reaches for `node:fs` cannot
 * be. Everything here is server-only and the split is what keeps that true by
 * construction rather than by care.
 *
 * Files rather than module state, because the dev server reloads modules on every edit
 * and a demo whose flags reset when someone saves a file is a demo that fails on stage.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/server/paths";
import { NO_FLAGS, type Flags, type Order } from "./shop";

const FLAGS_FILE = path.join(DATA_DIR, "shoplite-flags.json");
const ORDERS_FILE = path.join(DATA_DIR, "shoplite-orders.json");

export async function readFlags(): Promise<Flags> {
  try {
    const raw = JSON.parse(await readFile(FLAGS_FILE, "utf8")) as Partial<Flags>;
    return { drift: raw.drift === true, defect: raw.defect === true };
  } catch {
    return { ...NO_FLAGS };
  }
}

export async function writeFlags(flags: Flags): Promise<Flags> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FLAGS_FILE, JSON.stringify(flags, null, 2), "utf8");
  return flags;
}

export async function readOrders(): Promise<Order[]> {
  try {
    return JSON.parse(await readFile(ORDERS_FILE, "utf8")) as Order[];
  } catch {
    return [];
  }
}

export async function appendOrder(order: Order): Promise<void> {
  const all = await readOrders();
  all.unshift(order);
  await mkdir(DATA_DIR, { recursive: true });
  // Bounded: a demo that has been run forty times should not render forty pages of
  // orders, and an unbounded file is a slow page load waiting to be mistaken for a bug.
  await writeFile(ORDERS_FILE, JSON.stringify(all.slice(0, 25), null, 2), "utf8");
}
