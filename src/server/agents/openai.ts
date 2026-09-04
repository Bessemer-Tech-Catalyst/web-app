/**
 * SDK bootstrap and the single point the API key is read.
 *
 * Rules this file exists to enforce:
 *   - the key is read from the process environment, server-side, and nowhere else;
 *   - it is never written to the run workspace, an event, a log line or an error message;
 *   - it never crosses into the client bundle (no NEXT_PUBLIC_ prefix, and this module
 *     is under src/server so importing it from a client component is a build error);
 *   - tracing export is off by default, because the SDK's trace exporter would ship
 *     prompts — which contain the target app's pages and the run's credentials — to a
 *     third party. Turn it on deliberately with ODYSSEY_TRACING=1 or not at all.
 */

import { setDefaultOpenAIKey, setTracingDisabled } from "@openai/agents";

let bootstrapped = false;

/** True when a key is present. Callers use this to fall back to stubs rather than throw. */
export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

/**
 * Idempotently configures the SDK. Throws if no key is set — call `hasApiKey()` first
 * if you want to degrade instead. The thrown message deliberately names the variable
 * and not its value.
 */
export function configureOpenAI(): void {
  if (bootstrapped) return;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local (which is gitignored) to run the " +
        "real agents, or leave ODYSSEY_REAL_AGENTS unset to run against the stubs.",
    );
  }
  setDefaultOpenAIKey(key);
  setTracingDisabled(process.env.ODYSSEY_TRACING?.trim() !== "1");
  bootstrapped = true;
}

/**
 * Every secret a run knows about, for `redact()`. The API key is included so that even
 * if a provider error echoes it back to us, it cannot reach the event log.
 */
export function runSecrets(credentials?: { password: string }): string[] {
  const out: string[] = [];
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) out.push(key);
  if (credentials?.password) out.push(credentials.password);
  return out;
}
