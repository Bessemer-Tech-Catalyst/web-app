/**
 * The catalogue — and where the `drift` switch does its work.
 *
 * With `drift` on, every add button is labelled "Add to bag" instead of "Add to cart".
 * Nothing else changes: the button is in the same place, does the same thing, and the
 * page is entirely healthy. A test generated before the flip fails on a locator that
 * cannot be found, and the only correct verdict is SCRIPT_DRIFT.
 *
 * The label is the *accessible name*, which is what `getByRole('button', { name })`
 * matches on, so this breaks exactly the kind of locator the Generator prefers to write.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { CATALOGUE, SESSION_COOKIE, priceOf } from "../shop";
import { readFlags } from "../shop-state";
import { AddButton } from "./add-button";

export default async function ProductsPage() {
  if (!(await cookies()).get(SESSION_COOKIE)) redirect("/shoplite");
  const { drift } = await readFlags();
  const label = drift ? "Add to bag" : "Add to cart";

  return (
    <>
      <h1>Products</h1>
      <p className="sl-lede">Four things, in stock, priced in pounds.</p>

      <div className="sl-grid">
        {CATALOGUE.map((product) => (
          <article className="sl-card" key={product.id}>
            <h3>{product.name}</h3>
            <p className="sl-blurb">{product.blurb}</p>
            <div className="sl-row">
              <span className="sl-price">{priceOf(product.pence)}</span>
              <AddButton sku={product.id} label={label} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
