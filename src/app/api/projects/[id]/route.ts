import { removeProject } from "@/server/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forgets a project. The runs against it are untouched — they are the evidence, and
 * deleting a row on a page must never delete a result.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await removeProject(id);
  if (!removed) return Response.json({ error: "No such project" }, { status: 404 });
  return Response.json({ ok: true });
}
