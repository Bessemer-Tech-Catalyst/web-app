import { cancelRun } from "@/server/run-store";
import { isValidRunId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidRunId(id)) return Response.json({ error: "Unknown run" }, { status: 404 });
  return Response.json({ cancelled: cancelRun(id) });
}
