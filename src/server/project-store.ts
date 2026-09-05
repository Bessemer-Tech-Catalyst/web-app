/**
 * The project registry: every application this instance has been pointed at.
 *
 * Same persistence story as the run index — one JSON file under the data directory, no
 * database. A row lands here two ways: explicitly, from the Add project form, or
 * implicitly, the first time a run is started against a URL. Nothing a project *claims*
 * is stored: coverage, trend and run counts are folded out of the run index at read
 * time, so a project can never disagree with the runs it is made of.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths";
import type { RunInput } from "@/lib/types";

export const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

export type ProjectEnv = "production" | "staging" | "local";

export interface Project {
  id: string;
  name: string;
  url: string;
  env: ProjectEnv;
  authed: boolean;
  /** Filename of the last PRD a run against this project carried, if any. */
  prd?: string;
  addedAt: string;
  lastRunAt?: string;
  /** Whether a person added this or a run did. The page says which. */
  source: "manual" | "run";
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Two runs are against the same project when they are against the same origin *and*
 * path. `localhost:3000/shoplite` and `localhost:3000` are one process but two
 * applications, and folding them together would attribute one's coverage to the other.
 */
export function projectKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Stable across restarts, and derived — so a run never has to be told its project. */
export function projectIdFor(url: string): string {
  const key = projectKey(url);
  const slug = key
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  // The slug is there to be read; the hash is what keeps it unique after truncation.
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 6);
  return `prj_${slug.slice(0, 28)}_${hash}`;
}

export function inferName(url: string): string {
  try {
    const u = new URL(url);
    const segment = u.pathname.split("/").filter(Boolean).pop();
    const base = segment ?? u.hostname.replace(/^www\./, "").split(".")[0];
    return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

const NON_PROD = new Set(["staging", "stage", "dev", "develop", "test", "qa", "preview", "uat", "sandbox"]);

export function inferEnv(url: string): ProjectEnv {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local") ||
      h.endsWith(".localhost")
    ) {
      return "local";
    }
    // The last label is the TLD, and `.dev`, `.test` and `.qa` are all real ones —
    // matching against the whole hostname called `demo.playwright.dev` a staging
    // environment. Only the labels in front of it get a say.
    const labels = h.split(".").slice(0, -1);
    const words = labels.flatMap((label) => label.split("-"));
    if (words.some((w) => NON_PROD.has(w))) return "staging";
    return "production";
  } catch {
    return "production";
  }
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  try {
    const rows = JSON.parse(await readFile(PROJECTS_FILE, "utf8")) as Project[];
    if (!Array.isArray(rows)) return [];
    return rows.sort((a, b) =>
      (b.lastRunAt ?? b.addedAt).localeCompare(a.lastRunAt ?? a.addedAt),
    );
  } catch {
    return [];
  }
}

/** Serialised, for the same reason the run index is: concurrent runs share this file. */
let queue: Promise<void> = Promise.resolve();

function mutate(fn: (rows: Project[]) => Project[]): Promise<void> {
  queue = queue
    .catch(() => {})
    .then(async () => {
      const next = fn(await listProjects());
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(PROJECTS_FILE, JSON.stringify(next, null, 2), "utf8");
    });
  return queue;
}

export interface ProjectPatch {
  url: string;
  name?: string;
  env?: ProjectEnv;
  /** Left undefined on purpose by an unauthenticated run: it must not un-know auth. */
  authed?: boolean;
  prd?: string;
  lastRunAt?: string;
  source?: Project["source"];
}

export function upsertProject(patch: ProjectPatch): Promise<Project> {
  let saved!: Project;
  return mutate((rows) => {
    const id = projectIdFor(patch.url);
    const existing = rows.find((r) => r.id === id);
    saved = {
      id,
      name: patch.name?.trim() || existing?.name || inferName(patch.url),
      // The first URL seen wins, so a later run with a trailing slash or a query
      // string does not rewrite what the card has been showing.
      url: existing?.url ?? patch.url,
      env: patch.env ?? existing?.env ?? inferEnv(patch.url),
      authed: patch.authed ?? existing?.authed ?? false,
      prd: patch.prd ?? existing?.prd,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      lastRunAt: patch.lastRunAt ?? existing?.lastRunAt,
      source: existing?.source ?? patch.source ?? "manual",
    };
    return [saved, ...rows.filter((r) => r.id !== id)];
  }).then(() => saved);
}

export function removeProject(id: string): Promise<boolean> {
  let removed = false;
  return mutate((rows) => {
    removed = rows.some((r) => r.id === id);
    return rows.filter((r) => r.id !== id);
  }).then(() => removed);
}

/**
 * Called on the way into every run. This is the whole "run something new and it shows
 * up under Projects" story: the registry is a side effect of running, not a form
 * somebody has to remember to fill in first.
 */
export async function registerRunProject(input: RunInput): Promise<string> {
  const project = await upsertProject({
    url: input.url,
    authed: input.credentials ? true : undefined,
    prd: input.prd?.filename,
    lastRunAt: new Date().toISOString(),
    source: "run",
  });
  return project.id;
}
