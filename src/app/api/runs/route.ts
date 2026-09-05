import { createRun, listRuns } from "@/server/run-store";
import { parseRunInput } from "@/server/validate";
import { requireCiToken } from "@/app/api/auth/require-ci-token";

// The orchestrator spawns browsers and writes files — Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ runs: await listRuns() });
}

export async function POST(req: Request) {
  // Auth check: if ODYSSEY_CI_TOKEN env var is set, require bearer token
  const auth = await requireCiToken(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = parseRunInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { id } = await createRun(parsed.value);
  return Response.json({ id }, { status: 201 });
}
