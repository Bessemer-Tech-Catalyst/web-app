/**
 * ShopLite sign-in. A real form post against a real endpoint, because Recon has to be
 * able to find it and sign in unaided, and a fake login teaches us nothing about that.
 *
 * The wrong-password path answers 401 with a message the page renders — that is the
 * negative-path flow the Planner is supposed to notice and cover, and it only exists to
 * be noticed.
 */

import { NextResponse } from "next/server";
import { DEMO_USER, SESSION_COOKIE } from "@/app/shoplite/shop";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };

  if (body.email?.trim().toLowerCase() !== DEMO_USER.email || body.password !== DEMO_USER.password) {
    // Deliberately not saying which half was wrong, like any application that has had a
    // security review — and a more interesting assertion for a generated test than "an
    // error appeared".
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const response = NextResponse.json({ email: DEMO_USER.email });
  response.cookies.set(SESSION_COOKIE, DEMO_USER.email, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
