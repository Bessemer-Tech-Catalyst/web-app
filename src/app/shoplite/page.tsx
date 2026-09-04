/**
 * ShopLite sign-in. The page Recon lands on with a bare URL and a pair of credentials.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/shoplite/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Sign in failed.");
      return;
    }
    router.push("/shoplite/products");
    router.refresh();
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="sl-lede">Your basket is kept for this browser session only.</p>

      <form className="sl-panel" onSubmit={submit} noValidate>
        {/* Rendered only on failure, so a generated test can assert its absence on the
            happy path and its text on the negative one. It carries a test id as well as
            its role because Next renders a permanent, empty `role="alert"` route
            announcer into every page — `getByRole('alert')` alone is a strict-mode
            violation waiting to happen, in this app and in anyone else's. */}
        {error ? (
          <p className="sl-error" role="alert" data-testid="sign-in-error">
            {error}
          </p>
        ) : null}

        <label className="sl-field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="sl-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="sl-btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </>
  );
}
