/**
 * How a plan becomes `specs/core.md`.
 *
 * Shared by the real Planner and by `stubAgents` on purpose: the stub's whole value is
 * that it exercises the real transport with the real file layout, and it stops doing
 * that the moment the two renderers drift apart.
 */

import type { Scenario } from "@/lib/types";

export function renderSpec(url: string, scenarios: Scenario[]): string {
  const lines = [`# Test plan — ${url}`, ""];
  for (const [i, s] of scenarios.entries()) {
    lines.push(
      `## ${i + 1}. ${s.title}`,
      "",
      `- **Flow:** ${s.flow}`,
      `- **Kind:** ${s.kind}`,
      `- **Priority:** ${s.priority}`,
      s.addedByCritique ? "- **Added by:** coverage critic" : "",
      "",
      "**Steps**",
      ...s.steps.map((step, j) => `${j + 1}. ${step}`),
      "",
      `**Expected:** ${s.expected}`,
      "",
    );
  }
  return lines.filter((l) => l !== "").join("\n") + "\n";
}
