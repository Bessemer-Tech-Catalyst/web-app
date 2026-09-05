/**
 * The assertion-integrity guard — the gate inside HEAL.
 *
 * The cheapest way to make a failing test pass is to weaken what it checks. A healer
 * that may rewrite assertions will, eventually, quietly delete the reason the test
 * exists. So ours may rewrite **locators and waits only**: we parse the assertion set
 * out of the patch's before/after and reject any patch that drops an assertion,
 * loosens a matcher, flips a negation, or changes an expected value.
 *
 * Deliberately syntactic rather than model-judged — the guard has to be something we
 * can point at on stage and say "this cannot be talked out of."
 */

export interface Assertion {
  /** Everything inside `expect(...)` — the thing under test. */
  subject: string;
  matcher: string;
  negated: boolean;
  /** The matcher's arguments, normalised. Empty for `toBeVisible()`. */
  expected: string;
}

/**
 * Matcher strength. A patch may move up this ladder, never down: swapping
 * `toHaveText('Order #1')` for `toBeVisible()` still passes, but stops proving
 * anything about the thing the test was written to prove.
 */
const STRENGTH: Record<string, number> = {
  toBeAttached: 1,
  toBeVisible: 1,
  toBeInViewport: 1,
  toBeEnabled: 2,
  toBeDisabled: 2,
  toBeChecked: 2,
  toBeEmpty: 2,
  toContainText: 3,
  toHaveCount: 3,
  toHaveClass: 3,
  toHaveAttribute: 3,
  toHaveURL: 4,
  toHaveTitle: 4,
  toHaveText: 4,
  toHaveValue: 4,
  toHaveScreenshot: 4,
  toBe: 5,
  toEqual: 5,
  toStrictEqual: 5,
};

const strengthOf = (matcher: string) => STRENGTH[matcher] ?? 3;

/** Scans for `expect(<subject>)[.not].<matcher>(<args>)`, balancing nested parens. */
export function parseAssertions(source: string): Assertion[] {
  const out: Assertion[] = [];
  const re = /\bexpect(?:\.soft)?\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(source))) {
    const subjectStart = m.index + m[0].length;
    const subjectEnd = matchParen(source, subjectStart);
    if (subjectEnd < 0) continue;

    let cursor = subjectEnd + 1;
    let negated = false;

    // Walk the `.not.` / `.resolves.` / `.rejects.` chain to the matcher call.
    for (;;) {
      const chain = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*/.exec(source.slice(cursor));
      if (!chain) break;
      const name = chain[1];
      cursor += chain[0].length;

      if (name === "not") {
        negated = !negated;
        continue;
      }
      if (name === "resolves" || name === "rejects") continue;

      if (source[cursor] !== "(") break;
      const argsEnd = matchParen(source, cursor + 1);
      if (argsEnd < 0) break;

      out.push({
        subject: normalise(source.slice(subjectStart, subjectEnd)),
        matcher: name,
        negated,
        expected: normalise(source.slice(cursor + 1, argsEnd)),
      });
      break;
    }
    re.lastIndex = cursor;
  }
  return out;
}

/** Index of the `)` closing the `(` that opened just before `start`. */
function matchParen(src: string, start: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Whitespace-insensitive so a reformat is not mistaken for a behaviour change. */
const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

export interface GuardVerdict {
  intact: boolean;
  /** Human-readable reasons, ready to put straight into a decision event. */
  violations: string[];
  before: Assertion[];
  after: Assertion[];
}

export function checkAssertionIntegrity(before: string, after: string): GuardVerdict {
  const a = parseAssertions(before);
  const b = parseAssertions(after);
  const violations: string[] = [];

  if (b.length < a.length) {
    violations.push(
      `${a.length - b.length} assertion(s) deleted — ${a.length} before, ${b.length} after`,
    );
  }

  // Pair by subject first: a healer legitimately rewrites the *locator* inside
  // expect(), so fall back to positional pairing when the subject moved.
  //
  // The fallback takes `pool[0]` — the earliest item not yet claimed — rather than an
  // index derived from `i`, the assertion's position in the *original, unshrunk* `a`.
  // Exact-subject matches are consumed from `pool` in the same order `a` is walked, so
  // whatever remains in `pool` when a subject-match fails is already in original
  // relative order; `pool[0]` is provably the correct partner. `Math.min(i, pool.length
  // - 1)` is not: `i` keeps counting the full original array while `pool` has been
  // shrinking, so once a few items have been claimed it names the *wrong slot* — on a
  // real run (`run_0aa69767`) this mispaired a Healer's `.first()` addition on a
  // "2× Copper stovetop kettle" assertion against an unrelated, untouched "£84.00"
  // assertion nine lines later (the two shared no subject, but the test happened to
  // repeat the `£84.00` cell locator once on the basket page and once on the order
  // history page), and it read the mismatch as an "expected value changed" violation —
  // rejecting a correct fix for a defect that was never there.
  const pool = [...b];
  for (const prev of a) {
    const bySubject = pool.findIndex((x) => x.subject === prev.subject);
    const idx = bySubject >= 0 ? bySubject : pool.length > 0 ? 0 : -1;
    if (idx < 0) {
      violations.push(`assertion on \`${prev.subject}\` has no counterpart after the patch`);
      continue;
    }
    const next = pool.splice(idx, 1)[0];

    if (prev.negated !== next.negated) {
      violations.push(
        `negation flipped on \`${prev.matcher}\` (${prev.negated ? ".not " : ""}→ ${next.negated ? ".not" : "positive"})`,
      );
    }
    if (strengthOf(next.matcher) < strengthOf(prev.matcher)) {
      violations.push(
        `matcher weakened: ${prev.matcher}(${prev.expected}) → ${next.matcher}(${next.expected})`,
      );
    }
    if (
      prev.matcher === next.matcher &&
      prev.expected !== next.expected &&
      prev.expected !== ""
    ) {
      violations.push(
        `expected value changed: ${prev.matcher}(${prev.expected}) → ${next.matcher}(${next.expected})`,
      );
    }
  }

  return { intact: violations.length === 0, violations, before: a, after: b };
}
