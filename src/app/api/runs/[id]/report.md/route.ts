import { getRunState } from "@/server/run-store";
import { requireCiToken } from "@/app/api/auth/require-ci-token";
import { reportMarkdown } from "@/server/report-markdown";
import { isValidRunId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check: if ODYSSEY_CI_TOKEN env var is set, require bearer token
  const auth = await requireCiToken(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidRunId(id)) {
    return Response.json({ error: "Invalid run ID" }, { status: 400 });
  }

  const state = await getRunState(id);
  if (!state?.report) {
    return Response.json(
      { error: "Run not found or report not yet complete" },
      { status: 404 }
    );
  }

  const markdown = reportMarkdown(state.report);

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="odyssey-report-${id}.md"`,
    },
  });
}
