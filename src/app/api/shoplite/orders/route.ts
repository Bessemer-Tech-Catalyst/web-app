/**
 * Order history and order placement — and the deliberate defect.
 *
 * With the `defect` flag on, GET answers 500. That is the whole bug: the checkout still
 * works, the order is still placed, and the *history* page is broken. A test that placed
 * an order and then asserted it appears in the history fails on an element that is not
 * there, which is precisely the failure shape a naive classifier calls "the locator
 * moved" and heals — deleting the finding.
 *
 * What separates the two here is available to anyone who looks: the response is a 500
 * and the page logs the failure to the console. The classifier has a read-only browser
 * with `browser_network_requests` and `browser_console_messages` for exactly this.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CATALOGUE, SESSION_COOKIE, type Order } from "@/app/shoplite/shop";
import { appendOrder, readFlags, readOrders } from "@/app/shoplite/shop-state";

export async function GET() {
  const email = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { defect } = await readFlags();
  if (defect) {
    // The bug, in one line. Shaped like a real one: a server error on a read path, with
    // nothing wrong upstream of it, so the symptom is a missing element on a page that
    // otherwise renders.
    return NextResponse.json(
      { error: "ORDER_HISTORY_UNAVAILABLE", detail: "orders.list failed: connection pool exhausted" },
      { status: 500 },
    );
  }

  const orders = (await readOrders()).filter((o) => o.email === email);
  return NextResponse.json({ orders });
}

export async function POST(request: Request) {
  const email = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { lines?: { sku: string; qty: number }[] };
  const lines = (body.lines ?? [])
    .map((l) => {
      const product = CATALOGUE.find((p) => p.id === l.sku);
      const qty = Math.max(1, Math.min(9, Math.trunc(l.qty) || 1));
      return product ? { sku: product.id, name: product.name, qty, pence: product.pence } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (!lines.length) {
    return NextResponse.json({ error: "Your basket is empty." }, { status: 400 });
  }

  const order: Order = {
    // Sequential-looking and unique. A test can assert the exact id it was shown.
    id: `SL-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    placedAt: new Date().toISOString(),
    email,
    lines,
    totalPence: lines.reduce((n, l) => n + l.pence * l.qty, 0),
  };
  await appendOrder(order);
  return NextResponse.json({ order }, { status: 201 });
}
