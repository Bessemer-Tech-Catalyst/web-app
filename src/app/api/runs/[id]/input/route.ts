import { getRunInput } from "@/server/run-store";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const input = await getRunInput(id);

  if (!input) {
    return Response.json({ error: "Run input not found" }, { status: 404 });
  }

  return Response.json({ input });
}
