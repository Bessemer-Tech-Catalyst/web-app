/**
 * The one place model ids live.
 *
 * `docs/IMPLEMENTATION_PLAN.md` §4 left these unpinned on purpose so they would be
 * chosen at the point of the first real call rather than scattered through a plan.
 * This is that point.
 *
 * The defaults are deliberately the cheapest tier OpenAI publishes, not the strongest:
 * Phase 3 is a build-and-iterate phase and the credit burn of a frontier model on every
 * churn is not worth it yet. §4's "frontier reasoning, high" assignment is still the
 * intended production setting — reach it by setting the env overrides below, which is a
 * restart rather than a code change. Reasoning effort is the second dial: same model,
 * more thinking, roughly linear cost.
 *
 * Nothing here reads or holds the API key. That lives in `./openai.ts`.
 */

/**
 * Mirrors `ModelSettingsReasoningEffort` in @openai/agents, which the package does not
 * re-export by name. Kept as a local union so a tier is a compile error rather than a
 * runtime 400 when a value here drifts from what the SDK accepts.
 */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ModelTier {
  model: string;
  effort: ReasoningEffort;
  /** USD per million tokens, used to price streamed usage into the budget guard. */
  usdPerMTokIn: number;
  usdPerMTokOut: number;
}

/**
 * Published per-million-token rates, keyed by model id. Kept beside the ids because a
 * pinned id with a stale price silently lies to the budget guard, and the guard is the
 * only thing standing between a wedged agent loop and the credit balance.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-6-astra": { in: 4.0, out: 20.0 },
  "gpt-5.6-sol": { in: 4.0, out: 20.0 },
  "gpt-5.6-terra": { in: 2.0, out: 12.0 },
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
};

/** What we fall back to when a model id has no published price on file. */
const UNKNOWN_PRICE = { in: 4.0, out: 20.0 };

const DEFAULT_MODEL = "gpt-5.6-luna";

function tier(envKey: string, defaultEffort: ReasoningEffort): ModelTier {
  const model = process.env[envKey]?.trim() || process.env.ODYSSEY_MODEL?.trim() || DEFAULT_MODEL;
  const effort = (process.env[`${envKey}_EFFORT`]?.trim() as ReasoningEffort | undefined) || defaultEffort;
  const price = PRICES[model] ?? UNKNOWN_PRICE;
  return {
    model,
    effort,
    usdPerMTokIn: price.in,
    usdPerMTokOut: price.out,
  };
}

/**
 * Per-agent tiers. Read lazily so a change to the environment takes effect on the next
 * run rather than requiring a rebuild, and so importing this module never touches env
 * at module scope (which would bake dev values into the build).
 *
 * Overrides, in precedence order:
 *   ODYSSEY_MODEL_RECON / _PLANNER / _CRITIC / _GENERATOR   — per agent
 *   ODYSSEY_MODEL                                           — all agents
 *   the pinned default above
 * Effort takes `<VAR>_EFFORT`, e.g. ODYSSEY_MODEL_CRITIC_EFFORT=high.
 */
export const models = {
  /** High volume, low judgment — crawl summarisation. */
  get recon(): ModelTier {
    return tier("ODYSSEY_MODEL_RECON", "low");
  },
  /** Open-ended exploration; the effort dial matters more here than the model. */
  get planner(): ModelTier {
    return tier("ODYSSEY_MODEL_PLANNER", "medium");
  },
  /** The judgment call the product is built around — never run this below medium. */
  get critic(): ModelTier {
    return tier("ODYSSEY_MODEL_CRITIC", "medium");
  },
  /** Writes code that has to compile and run. §4 scores generated-code quality at 20%. */
  get generator(): ModelTier {
    return tier("ODYSSEY_MODEL_GENERATOR", "medium");
  },
  /**
   * Broken test or broken app. The other judgment call the product is built around, and
   * the one whose wrong answer is most expensive: healing a real defect deletes it.
   */
  get classifier(): ModelTier {
    return tier("ODYSSEY_MODEL_CLASSIFIER", "medium");
  },
  /** A long agentic loop that has to re-prove every locator it writes. */
  get healer(): ModelTier {
    return tier("ODYSSEY_MODEL_HEALER", "medium");
  },
  /**
   * The risk ledger's review pass.
   *
   * `low` by default and that is not cost-cutting: the scores arrive already computed,
   * so this stage is asked only whether the rules missed something. A tier that reasons
   * harder here mostly reasons itself into adjustments it then cannot justify — and the
   * gate throws those away, so the spend buys nothing.
   */
  get risk(): ModelTier {
    return tier("ODYSSEY_MODEL_RISK", "low");
  },
  /**
   * PRD extraction and mapping. Long input, and the failure mode is subtle — a plausible
   * requirement the document does not contain, or a scenario mapped on shared vocabulary
   * rather than on what it does. Worth medium.
   */
  get prd(): ModelTier {
    return tier("ODYSSEY_MODEL_PRD", "medium");
  },
};

/** Prices a stage's streamed usage so the orchestrator's budget guard can act on it. */
export function priceUsage(t: ModelTier, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * t.usdPerMTokIn + (tokensOut / 1e6) * t.usdPerMTokOut;
}

/** For the Settings surface and the run header — never includes credentials. */
export function describeModels() {
  return {
    recon: models.recon,
    planner: models.planner,
    critic: models.critic,
    generator: models.generator,
    classifier: models.classifier,
    healer: models.healer,
    risk: models.risk,
    prd: models.prd,
  };
}
