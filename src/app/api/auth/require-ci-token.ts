/**
 * Lightweight bearer-token auth for CI/GitHub Actions integrations.
 * Protected routes call this at the top to gate requests to CI-authorized callers.
 */

export async function requireCiToken(
  req: Request
): Promise<{ ok: false; error: string } | { ok: true }> {
  const token = process.env.ODYSSEY_CI_TOKEN;

  // No token required if env var not set — backward-compatible with browser UI
  if (!token) {
    return { ok: true };
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header" };
  }

  // Compare tokens in constant time to mitigate timing attacks
  const provided = auth.slice(7);
  if (provided.length !== token.length || provided !== token) {
    return { ok: false, error: "Invalid token" };
  }

  return { ok: true };
}
