/**
 * The basket route's session guard.
 *
 * This file exists because The Odyssey found its absence. In `run_6f0284ae` the Generator
 * emitted one test — "an anonymous shopper is redirected away from a protected route" —
 * it went red, and the classifier called it `APP_DEFECT` at 0.72 with cross-test evidence:
 * `/shoplite/basket` and `/shoplite/orders` both rendered their content to a browser
 * carrying no session, while `/shoplite` showed a sign-in form. Nobody planted that bug.
 * ShopLite's own requirements say a protected page returns an unauthenticated shopper to
 * sign in (PRD §1.4), and two of the three did not.
 *
 * The cause was structural rather than an oversight: both pages are client components,
 * and `cookies()` is not available to one. `/shoplite/products` was a server component and
 * had the guard all along, which is exactly the "missing or inconsistent" the classifier
 * named. So the route is a server component now, and the interactive half is a child.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../shop";
import { BasketClient } from "./basket-client";

export default async function BasketPage() {
  if (!(await cookies()).get(SESSION_COOKIE)) redirect("/shoplite");
  return <BasketClient />;
}
