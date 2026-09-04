/**
 * The gate inside GENERATE: a locator that was never resolved on the live page does not
 * ship (docs/IMPLEMENTATION_PLAN.md §3.2).
 *
 * The mechanism is deliberately not "the model promises it checked". Playwright MCP
 * answers every call that touches an element with the Playwright code it just ran:
 *
 *     ### Ran Playwright code
 *     ```js
 *     await page.getByRole('button', { name: 'New appointment' }).click();
 *     ```
 *
 * and `browser_generate_locator` answers with the bare expression:
 *
 *     ### Result
 *     getByRole('button', { name: 'New appointment' })
 *
 * Every one of those is an element that provably existed, in that state, seconds ago —
 * written by Playwright, not by a model. `harvest` folds them into a set; `prove`
 * then reads the emitted test file and asks, of every locator in it, whether the ledger
 * contains it. Anything it does not is a guess, and a scenario carrying a guess is
 * quarantined rather than shipped.
 *
 * Comparison is on a canonical form, so `getByRole("button", {name: "Save"})` and
 * `getByRole('button', { name: 'Save' })` are the same locator — quoting and whitespace
 * are the model's choice and must not decide whether a test ships.
 */

/** Locator factories. A chain has to start with one of these to be a locator at all. */
const FACTORIES = new Set([
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "locator",
  "frameLocator",
]);

/**
 * Refinements that can only narrow an already-proven set, so they are allowed to appear
 * on a locator whose base is in the ledger. `.getByRole(...)` is deliberately *not* here:
 * a descendant is a different element and needs its own proof.
 */
const REFINEMENTS = new Set(["first", "last", "nth", "filter", "describe"]);

/** Things done *to* a locator. They are not part of its identity. */
const ACTIONS = new Set([
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "pressSequentially",
  "check",
  "uncheck",
  "setChecked",
  "hover",
  "focus",
  "blur",
  "clear",
  "tap",
  "selectOption",
  "selectText",
  "setInputFiles",
  "dragTo",
  "scrollIntoViewIfNeeded",
  "waitFor",
  "screenshot",
  "highlight",
  "count",
  "all",
  "allInnerTexts",
  "allTextContents",
  "textContent",
  "innerText",
  "inputValue",
  "getAttribute",
  "isVisible",
  "isEnabled",
  "isChecked",
  "boundingBox",
]);

export interface Proof {
  /** Distinct locators the file uses. */
  total: number;
  /** How many of them the ledger accounts for. */
  verified: number;
  /** The ones it does not, in the form they appear in the file. */
  unproven: string[];
}

// ---------------------------------------------------------------------------
// Building the ledger
// ---------------------------------------------------------------------------

/**
 * Folds one Playwright MCP tool reply into the ledger.
 *
 * Both shapes above are read. Failed calls carry neither — a missing element answers
 * "### Error", with no code block and no result — so they contribute nothing, which is
 * exactly right.
 */
export function harvest(ledger: Set<string>, toolOutput: string): void {
  for (const chain of chainsIn(toolOutput)) register(ledger, chain);

  // `browser_generate_locator` returns the expression with no `page.` in front of it.
  for (const m of toolOutput.matchAll(/(?:^|\n)### Result\n([^\n]+)/g)) {
    const line = m[1].trim();
    const head = /^([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (head && FACTORIES.has(head[1])) register(ledger, `page.${line}`);
  }
}

/** Registers a proven chain and every locator prefix of it. */
function register(ledger: Set<string>, chain: string): void {
  const segs = locatorSegments(chain);
  if (!segs) return;
  for (let n = 1; n <= segs.length; n++) {
    ledger.add(canonical(segs.slice(0, n)));
  }
}

// ---------------------------------------------------------------------------
// Checking a generated file against it
// ---------------------------------------------------------------------------

export function prove(code: string, ledger: Set<string>): Proof {
  const seen = new Map<string, boolean>();

  for (const chain of chainsIn(code)) {
    const segs = locatorSegments(chain);
    if (!segs) continue;
    const shown = `page.${segs.map((s) => s.name + s.args).join(".")}`;
    if (seen.has(shown)) continue;
    seen.set(shown, isProven(segs, ledger));
  }

  const unproven = [...seen].filter(([, ok]) => !ok).map(([expr]) => expr);
  return { total: seen.size, verified: seen.size - unproven.length, unproven };
}

/**
 * Proven if the ledger holds the whole chain, or holds the base it refines. A locator
 * built out of `.first()` / `.nth(2)` / `.filter(...)` on a proven base is still pinned
 * to elements we saw; a locator that reaches into a proven element for a child we never
 * resolved is not, and falls through to `false`.
 */
function isProven(segs: Segment[], ledger: Set<string>): boolean {
  for (let n = segs.length; n >= 1; n--) {
    if (ledger.has(canonical(segs.slice(0, n)))) return true;
    if (n > 1 && !REFINEMENTS.has(segs[n - 1].name)) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Segment {
  name: string;
  /** The argument list including its parentheses, verbatim. */
  args: string;
}

/**
 * Every `page.…(…)…` chain in a blob of text, whether that blob is a generated test file
 * or a tool reply. A scanner rather than a regular expression, because locator arguments
 * nest parentheses and quotes freely — `getByRole('button', { name: 'Save (draft)' })`
 * defeats anything regular.
 */
function chainsIn(source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < source.length; i++) {
    if (!source.startsWith("page", i)) continue;
    // Only a standalone `page`, not the tail of `mainPage` or `pageTwo`.
    if (i > 0 && /[\w$.]/.test(source[i - 1])) continue;
    if (/[\w$]/.test(source[i + 4] ?? "")) continue;

    const segs: Segment[] = [];
    let j = i + 4;
    for (;;) {
      const dot = skipSpace(source, j);
      if (source[dot] !== ".") break;
      const nameStart = skipSpace(source, dot + 1);
      const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(nameStart))?.[0];
      if (!name) break;
      const open = skipSpace(source, nameStart + name.length);
      if (source[open] !== "(") break;
      const close = matchParen(source, open);
      if (close < 0) break;
      segs.push({ name, args: source.slice(open, close) });
      j = close;
    }

    if (segs.length) {
      out.push(`page.${segs.map((s) => s.name + s.args).join(".")}`);
      i = j - 1;
    }
  }
  return out;
}

/**
 * The locator part of a chain: the leading factory plus every segment up to the first
 * action performed on it. Null when the chain is not a locator at all — `page.goto()`,
 * `page.waitForURL()` and friends land here and are correctly ignored.
 */
function locatorSegments(chain: string): Segment[] | null {
  const segs = parseSegments(chain);
  if (!segs.length || !FACTORIES.has(segs[0].name)) return null;
  const kept: Segment[] = [];
  for (const s of segs) {
    if (ACTIONS.has(s.name)) break;
    kept.push(s);
  }
  return kept.length ? kept : null;
}

function parseSegments(chain: string): Segment[] {
  const segs: Segment[] = [];
  let i = chain.startsWith("page") ? 4 : 0;
  for (;;) {
    const dot = skipSpace(chain, i);
    if (chain[dot] !== ".") break;
    const nameStart = skipSpace(chain, dot + 1);
    const name = /^[A-Za-z_$][\w$]*/.exec(chain.slice(nameStart))?.[0];
    if (!name) break;
    const open = skipSpace(chain, nameStart + name.length);
    if (chain[open] !== "(") break;
    const close = matchParen(chain, open);
    if (close < 0) break;
    segs.push({ name, args: chain.slice(open, close) });
    i = close;
  }
  return segs;
}

/**
 * The comparison key: the same locator written two ways has to produce one string.
 * Whitespace outside string literals goes; every literal is re-emitted from its decoded
 * value, so quote style and escaping stop mattering.
 */
function canonical(segs: Segment[]): string {
  return segs.map((s) => s.name + canonicalArgs(s.args)).join(".");
}

function canonicalArgs(args: string): string {
  let out = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'" || c === '"' || c === "`") {
      const lit = readString(args, i);
      if (lit) {
        out += `‹${lit.value}›`;
        i = lit.end - 1;
        continue;
      }
    }
    if (/\s/.test(c)) continue;
    out += c;
  }
  return out;
}

function readString(s: string, i: number): { value: string; end: number } | null {
  const quote = s[i];
  let value = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      const next = s[j + 1];
      value += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
      j++;
      continue;
    }
    if (c === quote) return { value, end: j + 1 };
    value += c;
  }
  return null;
}

/** Index just past the `)` matching the `(` at `open`, or -1 if it is unbalanced. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      const lit = readString(s, i);
      if (!lit) return -1;
      i = lit.end - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}
