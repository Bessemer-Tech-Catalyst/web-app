/**
 * The orders route's session guard. See the note in `../basket/page.tsx` — the same
 * missing guard, found by the same test, in the same run.
 *
 * Only the *route* moved to the server. Order history is still fetched by the client on
 * purpose, so the `defect` switch stays diagnosable: a 500 in the network log and an
 * `ORDER_HISTORY_UNAVAILABLE` line in the console are what let the classifier tell a
 * broken application from a moved locator without touching anything.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../shop";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage() {
  if (!(await cookies()).get(SESSION_COOKIE)) redirect("/shoplite");
  return <OrdersClient />;
}
