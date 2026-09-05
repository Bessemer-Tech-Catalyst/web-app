/**
 * Order history — the page the `defect` switch breaks.
 *
 * It fetches its own data from the client on purpose. With `defect` on the request comes
 * back 500 and this page logs it and renders an error, which means the whole diagnosis
 * is available to a classifier that only loads the page: a 500 in the network log and an
 * `ORDER_HISTORY_UNAVAILABLE` line in the console. Rendered on the server, the same bug
 * would show up as a page that simply lacks a row — indistinguishable, from the outside,
 * from a locator that moved.
 *
 * The session check is in `page.tsx`, on the server. See the note there.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { priceOf, type Order } from "../shop";

export function OrdersClient() {
  // `useSearchParams` suspends, and the boundary has to be above the component that
  // calls it rather than around the page.
  return (
    <Suspense fallback={<p className="sl-empty">Loading orders…</p>}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const placed = useSearchParams().get("placed");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/shoplite/orders")
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
          throw new Error(`${body.error ?? response.status}: ${body.detail ?? "no detail"}`);
        }
        return (await response.json()) as { orders: Order[] };
      })
      .then((body) => live && setOrders(body.orders))
      .catch((err: Error) => {
        if (!live) return;
        // The console line the classifier reads. It names the endpoint and the reason,
        // because a console error that says "something went wrong" is not evidence.
        console.error(`ShopLite: GET /api/shoplite/orders failed — ${err.message}`);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <h1>Orders</h1>
      <p className="sl-lede">Everything you have bought with this account.</p>

      {placed ? (
        <p className="sl-badge" data-testid="order-placed">
          Order {placed} placed
        </p>
      ) : null}

      {failed ? (
        <p className="sl-error" role="alert" data-testid="orders-error">
          We couldn’t load your order history. Please try again later.
        </p>
      ) : orders === null ? (
        <p className="sl-empty">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="sl-empty">You have not placed any orders yet.</p>
      ) : (
        <table className="sl-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} data-testid="order-row">
                <td>{order.id}</td>
                <td>{order.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</td>
                <td className="sl-price">{priceOf(order.totalPence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
