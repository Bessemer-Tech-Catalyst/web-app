/**
 * Serves one file out of a run's workspace.
 *
 * The report cites screenshots, videos, traces and patches, and until this existed it
 * cited them as paths on a disk the reader does not have. "Demo clarity" is 15% of the
 * score and a filename is not evidence; the picture of the page at the moment the test
 * died is.
 *
 * A run workspace is *not* a public directory, and two things in it must never leave the
 * process:
 *
 *   - `results/state.json` — the captured `storageState`. That is a live session for the
 *     application under test, cookies and localStorage included. Serving it would hand
 *     anyone who can reach this endpoint the account the run signed in as.
 *   - `browser-profile/` — Chrome's own profile for the run, which is the same secret in
 *     a less convenient shape.
 *
 * So access is allowed by *three* independent checks, and a path has to clear all of
 * them: the run id must match its pattern, the resolved path must still be inside that
 * run's directory after `path.resolve` has had its say, and the file must be of a type
 * this endpoint knows how to serve. The deny-list is listed first anyway, because
 * defence that depends on an allowlist staying complete is defence with a deadline.
 */

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { isValidRunId, runDir } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never served, whatever else is true of the request. */
const DENIED = [/(^|\/)state\.json$/i, /(^|\/)browser-profile(\/|$)/i, /(^|\/)input\.json$/i];

/**
 * What this endpoint knows how to serve, and as what.
 *
 * An allowlist rather than a lookup table with a fallback: an unknown extension is
 * refused instead of being handed over as `application/octet-stream`, because the set of
 * things a run workspace can contain grows every time an agent writes something new.
 */
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ndjson": "application/x-ndjson; charset=utf-8",
};

/** Big enough for a trace zip, small enough that a mistake cannot exhaust memory. */
const MAX_BYTES = 128 * 1024 * 1024;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: segments } = await params;
  if (!isValidRunId(id)) return deny("Unknown run", 404);

  const relative = segments.map(decodeSegment).join("/");
  if (!relative || DENIED.some((re) => re.test(relative))) return deny("Not available", 403);

  // `realpath` on the root too: on macOS the data dir often lives under /var, which is
  // itself a symlink to /private/var, so comparing an un-resolved root against a resolved
  // target would reject every legitimate file.
  const root = await realpath(runDir(id)).catch(() => runDir(id));
  // The containment check. `path.resolve` collapses `..` and any encoding that survived
  // the router, so this compares the *destination*, not the string that asked for it.
  const target = path.resolve(root, relative);
  const inside = target === root || target.startsWith(root + path.sep);
  if (!inside) return deny("Not available", 403);

  const type = TYPES[path.extname(target).toLowerCase()];
  if (!type) return deny("Not a servable artifact", 415);

  // The containment check again, after the filesystem has had its say. `path.resolve`
  // collapses `..` but knows nothing about symlinks, and `stat` follows them — so a link
  // inside the workspace pointing anywhere at all would otherwise clear every check above
  // and be served. Nothing in the pipeline writes symlinks; that is a reason to expect
  // this never to fire, not a reason to omit it.
  let real;
  let info;
  try {
    real = await realpath(target);
    info = await stat(real);
  } catch {
    return deny("No such artifact", 404);
  }
  if (real !== root && !real.startsWith(root + path.sep)) return deny("Not available", 403);
  if (!info.isFile()) return deny("Not a file", 404);
  if (info.size > MAX_BYTES) return deny("Artifact too large to serve", 413);

  const body = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(info.size),
      // Immutable because a run's artifacts never change after it finishes, and the
      // report page loads a dozen screenshots at once.
      "cache-control": "private, max-age=31536000, immutable",
      // Nothing here is trusted markup: a trace viewer's HTML and a generated .ts file
      // are both content this app happens to be storing, not part of this app.
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Router segments arrive percent-encoded; a malformed one is a rejected request. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "\0";
  }
}

const deny = (message: string, status: number) =>
  Response.json({ error: message }, { status });
