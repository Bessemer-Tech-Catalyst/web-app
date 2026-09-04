import { getRunInput, getRunState, isLive } from "@/server/run-store";
import { isValidRunId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A point-in-time snapshot — used for server-rendering the report page. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidRunId(id)) return Response.json({ error: "Unknown run" }, { status: 404 });

  const state = await getRunState(id);
  if (!state) return Response.json({ error: "Unknown run" }, { status: 404 });

  // The stored input still holds the credentials the run was given; they never
  // leave the process, so strip them before this crosses the wire.
  const input = await getRunInput(id);
  const safeInput = input
    ? {
        ...input,
        credentials: input.credentials
          ? { username: input.credentials.username, password: "" }
          : undefined,
      }
    : null;

  return Response.json({ state, input: safeInput, live: isLive(id) });
}
