/**
 * The diff the report shows for a heal.
 *
 * Computed here from the before/after the Healer returned, never taken from the model:
 * a patch artifact that does not match the file that actually ran is worse than no
 * artifact, because it is the thing a reviewer would check the heal against.
 *
 * Unified format, because that is what a person reading `patch-<test>-1.diff` expects
 * and what `git apply` would take. Plain LCS — these are single test files.
 */

export function unifiedDiff(before: string, after: string, file: string, context = 3): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = lcsOps(a, b);

  const header = `--- a/${file}\n+++ b/${file}\n`;
  const hunks: string[] = [];

  for (const group of groupChanges(ops, context)) {
    const lines = ops.slice(group.start, group.end);
    const aCount = lines.filter((o) => o.op !== "+").length;
    const bCount = lines.filter((o) => o.op !== "-").length;
    hunks.push(
      `@@ -${group.aStart + 1},${aCount} +${group.bStart + 1},${bCount} @@\n` +
        lines.map((o) => `${o.op === "=" ? " " : o.op}${o.text}`).join("\n"),
    );
  }

  return hunks.length ? `${header}${hunks.join("\n")}\n` : `${header}(no textual change)\n`;
}

interface Op {
  op: "=" | "-" | "+";
  text: string;
  /** Index in the original file, for the hunk header. */
  ai: number;
  bi: number;
}

/** Standard LCS table. O(n·m) is fine at the size of one spec file. */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ op: "=", text: a[i], ai: i++, bi: j++ });
    else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ op: "-", text: a[i], ai: i++, bi: j });
    else ops.push({ op: "+", text: b[j], ai: i, bi: j++ });
  }
  while (i < n) ops.push({ op: "-", text: a[i], ai: i++, bi: j });
  while (j < m) ops.push({ op: "+", text: b[j], ai: i, bi: j++ });
  return ops;
}

/** Runs of change plus `context` unchanged lines either side, merged where they touch. */
function groupChanges(ops: Op[], context: number) {
  const changed = ops.map((o) => o.op !== "=");
  const groups: { start: number; end: number; aStart: number; bStart: number }[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (!changed[i]) continue;
    const start = Math.max(0, i - context);
    let end = i + 1;
    // Extend while the next change is close enough that its context would overlap.
    for (let j = i + 1; j < ops.length && j <= end + context * 2; j++) {
      if (changed[j]) end = j + 1;
    }
    end = Math.min(ops.length, end + context);

    const last = groups.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else groups.push({ start, end, aStart: ops[start].ai, bStart: ops[start].bi });

    i = end - 1;
  }
  return groups;
}
