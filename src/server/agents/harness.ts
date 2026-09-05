/**
 * One streamed Agent SDK run, mapped onto the orchestrator's event contract.
 *
 * The Decision Log is the product, so narration is not a debugging afterthought: every
 * reasoning summary the model emits becomes an `agent.thinking` event and every tool
 * call becomes an `agent.tool` event, live, while the run is still in flight. That is
 * why runs here are always streamed even though only the final output is returned.
 *
 * Cost is metered the same way. The SDK gives per-request `usage`; we price it from the
 * tier in `./models.ts` and report it through `ctx.spend`, which is what lets the
 * orchestrator's budget guard trip mid-run rather than after the bill is already spent.
 */

import { Agent, run, type MCPServer } from "@openai/agents";
import type { z } from "zod";
import { configureOpenAI, runSecrets } from "./openai";
import { priceUsage, type ModelTier } from "./models";
import { redact } from "../event-log";
import type { AgentContext } from "../orchestrator/agents";
import type { AgentName } from "@/lib/types";

/** One completed tool call, as the caller sees it. See `AgentRunSpec.onTool`. */
export interface ToolObservation {
  name: string;
  /** The raw JSON arguments string, redacted. */
  args: string;
  /** The tool's own reply, redacted and untruncated. */
  output: string;
  ok: boolean;
}

export interface AgentRunSpec<S extends z.ZodType> {
  /** Which lane the narration shows up in. */
  as: AgentName;
  /** The SDK agent's own name — appears in traces and error messages. */
  name: string;
  tier: ModelTier;
  instructions: string;
  input: string;
  outputType: S;
  mcpServers?: MCPServer[];
  /** Hard ceiling on agentic looping. A wedged agent is a hung demo. */
  maxTurns?: number;
  /**
   * Every tool call's full reply, as it lands.
   *
   * The Generator needs this: Playwright MCP answers a click, a fill or a
   * `browser_generate_locator` with the exact locator expression it resolved, and that
   * reply is the only record that an element was ever proven to exist. Reading it here —
   * rather than believing the model's account of what it found — is what makes
   * "every emitted locator was verified" a measurement instead of a claim.
   */
  onTool?: (observation: ToolObservation) => void;
}

/**
 * Runs one agent to a validated structured output, narrating as it goes.
 *
 * Throws if the model finishes without producing output that satisfies the schema —
 * the caller decides whether that is fatal or falls back, because "the Planner failed"
 * and "Recon failed" have very different consequences for a run.
 */
export async function runStructured<S extends z.ZodType>(
  ctx: AgentContext,
  spec: AgentRunSpec<S>,
): Promise<z.infer<S>> {
  configureOpenAI();
  const secrets = runSecrets(ctx.input.credentials);
  const clean = (s: string) => redact(s, secrets);

  const agent = new Agent({
    name: spec.name,
    instructions: spec.instructions,
    model: spec.tier.model,
    modelSettings: {
      reasoning: { effort: spec.tier.effort, summary: "concise" },
      // The narration needs the model's reasoning summarised as it thinks, and the
      // budget guard needs usage back even on a run that is later aborted.
      preserveRawUsage: false,
    },
    outputType: spec.outputType,
    mcpServers: spec.mcpServers ?? [],
  });

  const stream = await run(agent, spec.input, {
    stream: true,
    signal: ctx.signal,
    maxTurns: spec.maxTurns ?? 40,
  });

  // Names the pending call so its output event can report the outcome against it.
  const pending = new Map<string, { name: string; args: string }>();

  for await (const event of stream) {
    if (event.type !== "run_item_stream_event") continue;
    const item = event.item;

    if (item.type === "reasoning_item") {
      const text = item.rawItem.content
        .map((c) => c.text)
        .join(" ")
        .trim();
      if (text) ctx.think(spec.as, clean(text));
      continue;
    }

    if (item.type === "tool_call_item") {
      const raw = item.rawItem as { type: string; callId?: string; name?: string; arguments?: string };
      if (raw.type !== "function_call" || !raw.name) continue;
      // Redaction runs before truncation, not after. The other way round, a secret cut
      // in half by the ellipsis no longer matches the value `redact()` looks for, and
      // the surviving half reaches the event log.
      const args = clean(raw.arguments ?? "");
      if (raw.callId) pending.set(raw.callId, { name: raw.name, args });
      ctx.tool(spec.as, raw.name, summariseArgs(args), true, detailOf(args));
      continue;
    }

    if (item.type === "tool_call_output_item") {
      const raw = item.rawItem as { callId?: string; status?: string };
      const call = (raw.callId && pending.get(raw.callId)) || { name: "tool", args: "" };
      if (raw.callId) pending.delete(raw.callId);
      const output = clean(textOf(item.output));
      // Playwright MCP reports a browser-side failure — a missing element, a blocked
      // navigation — as a normal reply whose body starts "### Error", not as a transport
      // failure. Treating those as successes made the activity feed claim the agent found
      // things it did not, which is precisely the lie this stage exists to prevent.
      const ok = raw.status !== "incomplete" && !/(^|\n)### Error\b/.test(output);
      // A failure carries its own reply as the detail, under the arguments that produced
      // it. The feed line is elided in the middle to fit a row, and the middle of a
      // Playwright error is where the call log that explains it lives.
      if (!ok) {
        const args = detailOf(call.args);
        ctx.tool(
          spec.as,
          call.name,
          elide(output, 200, 260),
          false,
          `${args ? `${args}\n\n` : ""}${cap(output)}`,
        );
      }
      spec.onTool?.({ name: call.name, args: call.args, output, ok });
      continue;
    }

    if (item.type === "message_output_item") {
      // Structured-output agents put their answer here; it is reported by the caller
      // as an artifact, not as narration, so there is nothing to emit.
      continue;
    }
  }

  await stream.completed;

  const usage = stream.state.usage;
  const tokensIn = usage?.inputTokens ?? 0;
  const tokensOut = usage?.outputTokens ?? 0;
  ctx.spend(priceUsage(spec.tier, tokensIn, tokensOut), tokensIn, tokensOut);

  const output = stream.finalOutput;
  if (output === undefined) {
    throw new Error(
      `${spec.name} finished without producing a result matching its output schema.`,
    );
  }
  return output as z.infer<S>;
}

/** A tool call's arguments, compacted to one readable line for the Decision Log. */
function summariseArgs(args: string): string {
  if (!args) return "—";
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const parts = Object.entries(parsed)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${truncate(String(typeof v === "object" ? JSON.stringify(v) : v), 80)}`);
    return parts.length ? parts.join(", ") : "—";
  } catch {
    return truncate(args, 160);
  }
}

/**
 * How much of a call is worth keeping for the console row a reader opens.
 *
 * A `browser_snapshot` reply is tens of kilobytes of accessibility tree, and this text is
 * appended to the event log *and* pushed down every open SSE connection. Four kilobytes
 * holds a full set of arguments and the head of any error worth reading.
 */
const DETAIL_LIMIT = 4000;

const cap = (s: string) =>
  s.length <= DETAIL_LIMIT ? s : `${s.slice(0, DETAIL_LIMIT)}\n…truncated`;

/** The same arguments as `summariseArgs`, pretty-printed and left whole. */
function detailOf(args: string): string | undefined {
  if (!args) return undefined;
  try {
    return cap(JSON.stringify(JSON.parse(args), null, 2));
  } catch {
    return cap(args);
  }
}

/**
 * A tool reply as text. MCP replies arrive as a content array; the SDK hands them over
 * as either a plain string or that array, depending on the transport.
 */
function textOf(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : typeof part === "string"
            ? part
            : "",
      )
      .join("\n");
  }
  if (output && typeof output === "object") {
    const o = output as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (o.content !== undefined) return textOf(o.content);
  }
  return output === undefined ? "" : JSON.stringify(output);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Keeps both ends of a long reply.
 *
 * Playwright puts the *cause* of an actionability failure on the last line of its call
 * log — "<div …> intercepts pointer events", "element is not stable", "element is not
 * enabled". Truncating from the front keeps only "waiting for getByRole(…) · locator
 * resolved to <button class=…", which says the element exists and nothing about why the
 * click never landed. That is the difference between an event log you can debug a run
 * from and one that just tells you something went wrong.
 */
function elide(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}\n…\n${s.slice(-tail)}`;
}
