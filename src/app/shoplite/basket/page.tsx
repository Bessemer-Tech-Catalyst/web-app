/**
 * The basket, and checkout in the same place — one page fewer for a demo to walk
 * through, and it keeps "place the order" and "see the total" in one assertion's reach.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOGUE, priceOf } from "../shop";
import { clearBasket, readBasket, setQty, type BasketLine } from "../basket";

export default function BasketPage() {
  const router = useRouter();
  const [lines, setLines] = useState<BasketLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read after mount: `sessionStorage` does not exist during the server render, and a
  // basket rendered as empty and then corrected is a flicker a test can race.
  useEffect(() => {
    const sync = () => setLines(readBasket());
    sync();
    window.addEventListener("shoplite:basket", sync);
    return () => window.removeEventListener("shoplite:basket", sync);
  }, []);

  const rows = (lines ?? []).flatMap((line) => {
    const product = CATALOGUE.find((p) => p.id === line.sku);
    return product ? [{ ...line, product }] : [];
  });
  const totalPence = rows.reduce((n, r) => n + r.product.pence * r.qty, 0);

  async function placeOrder() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/shoplite/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: rows.map((r) => ({ sku: r.sku, qty: r.qty })) }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "The order could not be placed.");
      return;
    }
    const { order } = (await response.json()) as { order: { id: string } };
    clearBasket();
    router.push(`/shoplite/orders?placed=${order.id}`);
  }

  if (lines === null) return <p className="sl-empty">Loading your basket…</p>;

  return (
    <>
      <h1>Basket</h1>
      <p className="sl-lede">Kept for this browser session only.</p>

      {/* See the note in the sign-in page about Next's route announcer. */}
      {error ? (
        <p className="sl-error" role="alert" data-testid="basket-error">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="sl-empty">Your basket is empty.</p>
      ) : (
        <>
          <table className="sl-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku}>
                  <td>{row.product.name}</td>
                  <td>
                    <input
                      className="sl-qty"
                      type="number"
                      min={0}
                      max={9}
                      aria-label={`Quantity for ${row.product.name}`}
                      value={row.qty}
                      onChange={(e) => setLines(setQty(row.sku, Number(e.target.value)))}
                    />
                  </td>
                  <td className="sl-price">{priceOf(row.product.pence * row.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sl-total">
            <span>Total</span>
            {/* Named, because "the total is £84.00" is the assertion a checkout test
                exists to make and it needs somewhere unambiguous to point. */}
            <span data-testid="basket-total" className="sl-price">
              {priceOf(totalPence)}
            </span>
          </div>

          <p style={{ marginTop: 22 }}>
            <button className="sl-btn" type="button" onClick={placeOrder} disabled={busy}>
              {busy ? "Placing order…" : "Place order"}
            </button>
          </p>
        </>
      )}
    </>
  );
}
