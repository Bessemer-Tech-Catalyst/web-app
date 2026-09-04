import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Section, SectionHeader } from "@/components/ui/primitives";
import { DEFAULT_RUN_OPTIONS, STAGE_META, STAGES } from "@/lib/types";

export const metadata = { title: "Settings — The Odyssey" };

const DEFAULTS: Array<{ label: string; value: string; note: string }> = [
  {
    label: "Max scenarios",
    value: String(DEFAULT_RUN_OPTIONS.maxScenarios),
    note: "Ceiling on what the planner may propose in one run",
  },
  {
    label: "Re-plan budget",
    value: String(DEFAULT_RUN_OPTIONS.maxReplans),
    note: "How many times the critic may send the plan back",
  },
  {
    label: "Heal attempts per test",
    value: String(DEFAULT_RUN_OPTIONS.maxHealAttemptsPerTest),
    note: "After this, the test is quarantined rather than patched again",
  },
  {
    label: "Parallel workers",
    value: String(DEFAULT_RUN_OPTIONS.parallelWorkers),
    note: "Flows executed concurrently during the run stage",
  },
  {
    label: "Spend cap",
    value: `$${DEFAULT_RUN_OPTIONS.budgetUsd}`,
    note: "The orchestrator halts and reports rather than exceed it",
  },
  {
    label: "Browser",
    value: DEFAULT_RUN_OPTIONS.headless ? "Headless" : "Headed",
    note: "Headed is useful for a live demo, slower everywhere else",
  },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Defaults every new run inherits. A run may override any of them at launch."
      />

      <PageBody className="grid lg:grid-cols-2 lg:divide-x lg:divide-base-850">
        <Section>
          <SectionHeader title="Run defaults" subtitle="Applied unless the launcher overrides them" />
          <div className="divide-y divide-base-850">
            {DEFAULTS.map((d) => (
              <div key={d.label} className="flex items-start justify-between gap-4 px-6 py-3.5">
                <div className="min-w-0">
                  <div className="text-[13px] text-base-200">{d.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-base-600">{d.note}</p>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums text-ember-400">
                  {d.value}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <div>
          <Section>
            <SectionHeader
              title="Agent roster"
              subtitle="Who owns each stage of the pipeline"
            />
            <div className="divide-y divide-base-850">
              {STAGES.map((stage) => (
                <div key={stage} className="px-6 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-base-200">
                      {STAGE_META[stage].label}
                    </span>
                    <Badge tone={STAGE_META[stage].owner === "Orchestrator" ? "ember" : "neutral"}>
                      {STAGE_META[stage].owner}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-base-600">
                    {STAGE_META[stage].blurb}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          <Section>
            <SectionHeader title="Safety rails" subtitle="Non-negotiable, not configurable" />
            <ul className="divide-y divide-base-850 text-xs leading-relaxed text-base-500">
              {[
                "A healer patch that weakens or removes an assertion is rejected outright.",
                "A failure classified as an application defect is filed as a bug and never healed.",
                "Selectors that don't resolve on the live page quarantine the scenario instead of shipping a guess.",
                "Credentials are held for the run only and redacted from every log line and model prompt.",
              ].map((line) => (
                <li key={line} className="px-6 py-3">
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </PageBody>
    </>
  );
}
