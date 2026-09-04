/**
 * Which agents are real, per method.
 *
 * Phase 3 ships Recon, the Planner and the Critic. Everything downstream is still
 * `stubAgents`, and the composition below is a per-method merge rather than an
 * all-or-nothing switch on purpose: being able to run "real Planner, stubbed everything
 * else" is what makes a six-stage pipeline debuggable, and the all-stub configuration
 * stays the offline fallback for a demo with no network.
 *
 * Selection is one environment variable:
 *
 *   ODYSSEY_REAL_AGENTS=            unset — every stage stubbed (the default)
 *   ODYSSEY_REAL_AGENTS=all         every implemented agent is real
 *   ODYSSEY_REAL_AGENTS=plan        real Planner, everything else stubbed
 *   ODYSSEY_REAL_AGENTS=recon,plan  as above, plus real Recon
 *
 * Method names match the `Agents` interface: recon, plan, critique. Naming a stage that
 * Phase 3 has not built yet is a configuration error and is reported as one, rather
 * than silently doing nothing.
 */

import { stubAgents } from "../orchestrator/stub-agents";
import { hasApiKey } from "./openai";
import { recon } from "./recon";
import { plan } from "./planner";
import { critique } from "./critic";
import type { Agents } from "../orchestrator/agents";

/** Everything Phase 3 implements for real. Extended in Phases 4-6. */
const REAL: Partial<Agents> = { recon, plan, critique };

export type RealAgentName = keyof typeof REAL;

export interface AgentSelection {
  agents: Agents;
  /** Which methods ended up real — for the run header and the startup log. */
  real: RealAgentName[];
  /** Why a requested agent was not used, if any. Surfaced, never swallowed. */
  notes: string[];
}

export function selectAgents(
  spec = process.env.ODYSSEY_REAL_AGENTS,
): AgentSelection {
  const notes: string[] = [];
  const requested = parse(spec, notes);

  if (requested.length && !hasApiKey()) {
    notes.push(
      "OPENAI_API_KEY is not set, so the real agents cannot run; falling back to stubs " +
        "for every stage. Add the key to .env.local to enable them.",
    );
    return { agents: stubAgents, real: [], notes };
  }

  const agents: Agents = { ...stubAgents };
  for (const name of requested) {
    Object.assign(agents, { [name]: REAL[name] });
  }
  return { agents, real: requested, notes };
}

function parse(spec: string | undefined, notes: string[]): RealAgentName[] {
  const raw = spec?.trim();
  if (!raw) return [];

  const names = Object.keys(REAL) as RealAgentName[];
  if (raw === "all") return names;

  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: RealAgentName[] = [];
  for (const name of wanted) {
    if ((names as string[]).includes(name)) {
      out.push(name as RealAgentName);
    } else {
      notes.push(
        `ODYSSEY_REAL_AGENTS names "${name}", which Phase 3 does not implement. ` +
          `Implemented: ${names.join(", ")}. That stage will run stubbed.`,
      );
    }
  }
  return out;
}
