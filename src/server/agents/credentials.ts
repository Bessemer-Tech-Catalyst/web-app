/**
 * How the run's credentials reach a generated test — and how they are kept out of it.
 *
 * Two problems meet here, and they pull in opposite directions.
 *
 * The first was found by a live run rather than reasoned about: a scenario about
 * *signed-out* behaviour — rejected credentials, a protected route bouncing an
 * anonymous visitor — has to type a password, and the Generator was never told one.
 * `run_90f1c9f5` quarantined its authentication scenario with the Generator's own
 * words: *"no valid ShopLite password was provided or discoverable for
 * ada@shoplite.test."* The credentials were in the run input the whole time; nothing
 * put them in the prompt. So they go in the prompt.
 *
 * The second is what that implies: an agent holding a password will write it into the
 * file, and the file is a `.spec.ts` a team is invited to commit. Asking the model
 * nicely not to is cooperation, not a control — the same distinction the locator
 * provenance gate is built on. So the emitted code is rewritten mechanically before it
 * is written to disk: every quoted occurrence of the password becomes a read of
 * `process.env.ODYSSEY_PASSWORD`, which the executor supplies to the runner and which
 * a human re-running the suite supplies themselves.
 *
 * The redaction is reported as a tool call, not performed quietly. A suite that needs
 * an environment variable and does not say so is a suite that fails on someone else's
 * machine for a reason they cannot see.
 */

export const USERNAME_ENV = "ODYSSEY_USERNAME";
export const PASSWORD_ENV = "ODYSSEY_PASSWORD";

/** What the emitted test reads instead of a literal. */
export const PASSWORD_EXPR = `process.env.${PASSWORD_ENV}!`;

export interface Redaction {
  code: string;
  /** How many literal occurrences were replaced. */
  count: number;
  /**
   * True when the password still appears somewhere the rewrite could not reach — inside
   * a longer string, a template literal with interpolation, a comment. The caller reports
   * this rather than shipping it.
   */
  residual: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces every quoted occurrence of `password` in `code` with a read of the
 * environment variable the runner sets.
 *
 * Only whole string literals are rewritten: `"lovelace"` and `'lovelace'` and
 * `` `lovelace` ``. A password that is a substring of a longer literal is left alone and
 * flagged, because guessing at how to splice an expression into someone else's string is
 * how a rewrite turns a working test into a syntax error.
 */
export function redactPassword(code: string, password: string): Redaction {
  if (!password) return { code, count: 0, residual: false };

  const p = escape(password);
  let count = 0;
  const replaced = code.replace(
    new RegExp(`(["'\`])${p}\\1`, "g"),
    () => {
      count++;
      return PASSWORD_EXPR;
    },
  );

  return { code: replaced, count, residual: replaced.includes(password) };
}

/**
 * The credentials block for an agent prompt.
 *
 * The username is a literal the test may carry; the password is named, because an agent
 * that has to *type* it into a live page during generation needs the value, and told
 * where it goes in the file, because that is the part it gets wrong.
 */
export function credentialsBriefing(credentials?: { username: string; password: string }): string[] {
  if (!credentials?.username) {
    return [
      "Credentials: none were supplied for this run. A scenario that requires signing in " +
        "cannot be walked to its signed-in state — quarantine it and say so.",
    ];
  }
  return [
    "",
    "CREDENTIALS FOR THIS RUN",
    `username: ${credentials.username}`,
    credentials.password
      ? `password: ${credentials.password}`
      : "password: none supplied — only the username is known.",
    "Use them when a scenario has to sign in from an anonymous session. Write the username " +
      `into the file as a literal; write the password as ${PASSWORD_EXPR}, which the runner ` +
      "supplies from the environment. Never write the password's value into the file — if you " +
      "do, it is rewritten to that expression before the file is saved and the rewrite is " +
      "reported.",
  ];
}
