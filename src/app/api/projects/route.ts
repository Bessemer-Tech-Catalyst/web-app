/**
 * The project registry, over HTTP. GET lists what is stored; POST adds one by hand.
 *
 * Adding a project here is deliberately *not* the same as starting a run — it records
 * an application worth testing without pretending anything has been measured about it.
 * The card that appears says "never run" until a run against that URL says otherwise.
 */

import { listProjects, upsertProject, type ProjectEnv } from "@/server/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENVS: ProjectEnv[] = ["production", "staging", "local"];

export async function GET() {
  return Response.json({ projects: await listProjects() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.url === "string" ? b.url.trim() : "";
  if (!raw) return Response.json({ error: "A URL is required" }, { status: 400 });

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return Response.json({ error: "That is not a valid URL" }, { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Response.json({ error: "Only http and https projects are supported" }, { status: 400 });
  }

  const env = ENVS.includes(b.env as ProjectEnv) ? (b.env as ProjectEnv) : undefined;
  const project = await upsertProject({
    url: url.toString(),
    name: typeof b.name === "string" ? b.name.slice(0, 80) : undefined,
    env,
    source: "manual",
  });

  return Response.json({ project }, { status: 201 });
}
