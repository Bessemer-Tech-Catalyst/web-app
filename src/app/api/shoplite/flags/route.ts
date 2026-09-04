/**
 * The two switches that break ShopLite on command. See `app/shoplite/shop.ts`.
 *
 * An endpoint rather than a restart, so the defect can be introduced *between* two
 * stages of a live run — generate the suite against a healthy app, flip a switch, and
 * let the judges watch the pipeline decide what kind of failure it is looking at.
 */

import { NextResponse } from "next/server";
import { readFlags, writeFlags } from "@/app/shoplite/shop-state";
import type { Flags } from "@/app/shoplite/shop";

export async function GET() {
  return NextResponse.json(await readFlags());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<Flags>;
  const current = await readFlags();
  return NextResponse.json(
    await writeFlags({
      drift: body.drift ?? current.drift,
      defect: body.defect ?? current.defect,
    }),
  );
}
