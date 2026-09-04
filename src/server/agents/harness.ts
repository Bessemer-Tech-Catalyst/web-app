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
  const pending = new Map<string, string>();

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
      if (raw.callId) pending.set(raw.callId, raw.name);
      ctx.tool(spec.as, raw.name, clean(summariseArgs(raw.arguments)));
      continue;
    }

    if (item.type === "tool_call_output_item") {
      const raw = item.rawItem as { callId?: string; status?: string };
      const name = (raw.callId && pending.get(raw.callId)) || "tool";
      if (raw.callId) pending.delete(raw.callId);
      const ok = raw.status !== "incomplete";
      if (!ok) ctx.tool(spec.as, name, clean(summariseOutput(item.output)), false);
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
function summariseArgs(args: string | undefined): string {
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

function summariseOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return truncate(text ?? "", 200);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
