/**
 * Everything the "Fill the ShopLite demo" button needs, in one request.
 *
 * The button exists because a live demo has a worst moment, and it is the thirty seconds
 * spent typing a URL, a password and a PRD into a form while a room watches. It also
 * removes two ways to be wrong on stage: the port, and the PRD.
 *
 * **The port.** ShopLite is served by this same process, so the only correct target URL
 * is this origin plus `/shoplite`. A hard-coded one is wrong the moment anybody runs
 * `pnpm dev --port` with a different number — and the launcher's ShopLite preset used to
 * be `https://shoplite.demo`, a domain that does not exist. The origin is read off the
 * request here, so it is right whatever port the server came up on.
 *
 * **The PRD.** It is read from `docs/shoplite-prd.md` rather than copied into this file,
 * because the demo's whole PRD story is that a judge can open the document and check a
 * quote against it. Two copies of a PRD is one copy too many.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEMO_USER } from "@/app/shoplite/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRD_PATH = path.join(process.cwd(), "docs", "shoplite-prd.md");

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  // A missing PRD is not a failed request: everything else the button fills is still
  // worth having, and the response says the document was not found rather than the
  // button silently producing a run with no traceability matrix.
  let prd: { filename: string; text: string } | null = null;
  let warning: string | undefined;
  try {
    prd = { filename: "shoplite-prd.md", text: await readFile(PRD_PATH, "utf8") };
  } catch {
    warning = `docs/shoplite-prd.md was not readable from ${process.cwd()}, so the PRD is not filled in.`;
  }

  return Response.json({
    url: `${origin}/shoplite`,
    intent: "Focus on checkout and authentication flows.",
    credentials: { username: DEMO_USER.email, password: DEMO_USER.password },
    prd,
    // Deliberately not `DEFAULT_RUN_OPTIONS`. Those are sized for a real application; these
    // are sized for a demo somebody is standing in front of — five scenarios and a $1.50
    // ceiling is the shape of the runs in docs/DEMO.md, at about ten minutes and $0.20.
    options: {
      maxScenarios: 5,
      maxReplans: 2,
      maxHealAttemptsPerTest: 2,
      parallelWorkers: 4,
      budgetUsd: 1.5,
    },
    warning,
  });
}
