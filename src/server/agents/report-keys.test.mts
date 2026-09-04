/**
 * The regression test for the report-to-generated-test match.
 *
 * `__fixtures__/playwright-report.json` is a real, unedited Playwright JSON report,
 * copied from the run workspace of `run_6ed4bb62` (a TodoMVC run: one generated spec,
 * which failed). It is kept verbatim, absolute paths and all, because the thing being
 * pinned is precisely what Playwright puts in the file — `config.rootDir` set to the
 * *tests directory* rather than the run workspace, and the spec named relative to that.
 *
 * The defect this pins: the old match compared `todos-add-active-item.spec.ts` from the
 * report against `tests/todos-add-active-item.spec.ts` as recorded by the run, as plain
 * strings. Those never match — and since an unmatched generated test is reported as a
 * failure, a suite that passed every test would have reported as a suite that failed
 * every test.
 *
 * Run with `pnpm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { keyOf, specsIn, type PwReport } from "./report-keys.ts";

const report = JSON.parse(
  readFileSync(new URL("./__fixtures__/playwright-report.json", import.meta.url), "utf8"),
) as PwReport;

/**
 * The workspace the fixture was produced in. Deriving it from the fixture's own
 * `rootDir` rather than hardcoding it is what lets the fixture stay verbatim: the report
 * says the tests live in `<workspace>/tests`, so the workspace is its parent.
 */
const rootDir = report.config?.rootDir ?? "";
const WORKSPACE = path.dirname(rootDir);

/** The file name the Generator records, which is workspace-relative by construction. */
const GENERATED_FILE = "tests/todos-add-active-item.spec.ts";

test("the fixture still has the shape the bug lived in", () => {
  assert.ok(rootDir, "the fixture must carry a config.rootDir");
  assert.equal(
    path.basename(rootDir),
    "tests",
    "Playwright must still be putting rootDir at the tests directory — if this changes, " +
      "the bug has changed shape and the rest of this file needs rereading, not repairing",
  );

  const specs = specsIn(report);
  assert.equal(specs.length, 1, "the fixture holds exactly one spec");
  assert.equal(
    specs[0].file,
    "todos-add-active-item.spec.ts",
    "the report names the spec relative to rootDir, not to the workspace",
  );
});

test("a generated test matches its own report entry", () => {
  const [spec] = specsIn(report);
  const reportKey = keyOf(spec.file, rootDir, WORKSPACE);
  const lookupKey = keyOf(GENERATED_FILE, WORKSPACE, WORKSPACE);

  assert.equal(reportKey, lookupKey);
  assert.equal(lookupKey, GENERATED_FILE, "the shared key is the workspace-relative path");
});

test("the plain-string comparison this replaced still fails to match", () => {
  // Kept as the regression it was: if these ever compare equal as strings, the defect
  // this file pins no longer has the shape described above.
  const stringNormalise = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");
  const [spec] = specsIn(report);
  assert.notEqual(stringNormalise(spec.file), stringNormalise(GENERATED_FILE));
});

test("an absolute path in the report produces the same key", () => {
  // Playwright has emitted both absolute and rootDir-relative `file` values across
  // versions, so the match must not depend on which one it is handed today.
  const [spec] = specsIn(report);
  assert.equal(
    keyOf(path.join(rootDir, spec.file), rootDir, WORKSPACE),
    keyOf(GENERATED_FILE, WORKSPACE, WORKSPACE),
  );
});

test("a rootDir at the workspace itself still matches", () => {
  // The other half of the range: with specs in more than one directory the common
  // ancestor moves up to the workspace, and the report then names the file
  // `tests/x.spec.ts`. The same comparison has to hold there too.
  assert.equal(
    keyOf("tests/todos-add-active-item.spec.ts", WORKSPACE, WORKSPACE),
    keyOf(GENERATED_FILE, WORKSPACE, WORKSPACE),
  );
});

test("specsIn inherits the file from the suite above a nested spec", () => {
  // Playwright nests a `describe` as a suite inside the file suite, and the inner spec
  // carries no `file` of its own. Losing that inheritance would drop the test silently,
  // which reads downstream as a generated test that produced no result — a failure.
  const nested: PwReport = {
    suites: [
      {
        file: "a.spec.ts",
        suites: [{ specs: [{ title: "inner" }] }],
        specs: [{ title: "outer" }],
      },
    ],
  };
  assert.deepEqual(
    specsIn(nested).map((s) => [s.title, s.file]),
    [
      ["outer", "a.spec.ts"],
      ["inner", "a.spec.ts"],
    ],
  );
});

test("specsIn tolerates an empty report", () => {
  assert.deepEqual(specsIn({}), []);
  assert.deepEqual(specsIn({ suites: [] }), []);
});
