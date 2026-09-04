/**
 * Matching a Playwright JSON report back to the tests the Generator emitted.
 *
 * This lives apart from `executor.ts` for one reason: it is the piece that was wrong, so
 * it is the piece that has to stay tested. `executor.ts` reaches for path aliases, the
 * run context and a child process, none of which a test can load; everything here
 * depends on `node:path` and nothing else, so `report-keys.test.ts` pins the real
 * functions rather than a copy of them that can drift.
 */

import path from "node:path";

export interface PwResultEntry {
  status?: string;
  duration?: number;
  error?: { message?: string };
  attachments?: { name?: string; path?: string; contentType?: string }[];
}
export interface PwSpec {
  title?: string;
  file?: string;
  tests?: { results?: PwResultEntry[] }[];
}
export interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
  errors?: { message?: string }[];
  /** `rootDir` is what every `file` in the report is relative to. See `keyOf`. */
  config?: { rootDir?: string };
}

/**
 * Every spec in the report, flattened, each carrying the file it belongs to.
 *
 * A spec does not always name its own file — nested suites inherit it from the file-level
 * suite above them — so the walk carries the last file it saw downwards.
 */
export function specsIn(report: PwReport): (PwSpec & { file: string })[] {
  const out: (PwSpec & { file: string })[] = [];
  const walk = (suites: PwSuite[] | undefined, inheritedFile: string) => {
    for (const suite of suites ?? []) {
      const file = suite.file ?? inheritedFile;
      for (const spec of suite.specs ?? []) out.push({ ...spec, file: spec.file ?? file });
      walk(suite.suites, file);
    }
  };
  walk(report.suites, "");
  return out;
}

/**
 * One key both sides of the match can be expressed in: the file's path relative to the
 * run workspace.
 *
 * This is not the string tidy-up it looks like. Playwright sets `config.rootDir` to the
 * common ancestor of the test files it collected, and with every generated spec sitting
 * directly in `tests/`, that ancestor is the *tests directory* — so the report calls the
 * file `login.spec.ts` while the run recorded it as `tests/login.spec.ts`. Comparing
 * those as strings matches nothing, and since an unmatched generated test is reported as
 * a failure, a suite that passed every test reports as a suite that failed every test.
 * That is precisely what this did before a real suite was ever run through it.
 *
 * Resolving each side against its own root and re-relativising is the comparison that
 * keeps working when Playwright moves `rootDir` — which it does, silently, whenever the
 * shape of the generated tree changes.
 */
export function keyOf(file: string, root: string, workspace: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  return path.relative(workspace, abs).split(path.sep).join("/");
}
