import { Badge, Card, CardHeader, Empty, type Tone } from "@/components/ui/primitives";
import { cn, formatDuration } from "@/lib/format";
import {
  TRIAGE_META,
  type GeneratedTest,
  type HealAttempt,
  type TestResult,
  type TestStatus,
  type TriageOutcome,
} from "@/lib/types";

const STATUS_TONE: Record<TestStatus, Tone> = {
  passed: "ok",
  healed: "ember",
  failed: "danger",
  quarantined: "violet",
  running: "info",
  pending: "neutral",
};

export function TestBoard({
  tests,
  results,
  triage,
  heals,
}: {
  tests: GeneratedTest[];
  results: Record<string, TestResult>;
  triage: TriageOutcome[];
  heals: HealAttempt[];
}) {
  const counts = tests.reduce<Record<string, number>>((acc, t) => {
    const st = results[t.id]?.status ?? "pending";
    acc[st] = (acc[st] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader
        title="Generated suite"
        subtitle="Locators proven live before the file was written"
        right={
          tests.length > 0 ? (
            <div className="flex gap-1">
              {(["passed", "healed", "failed"] as const).map((s) =>
                counts[s] ? (
                  <Badge key={s} tone={STATUS_TONE[s]} mono>
                    {counts[s]} {s}
                  </Badge>
                ) : null,
              )}
            </div>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tests.length === 0 ? (
          <Empty>No tests generated yet</Empty>
        ) : (
          <ul className="divide-y divide-base-850">
            {tests.map((t) => {
              const result = results[t.id];
              const status = result?.status ?? "pending";
              const verdict = triage.find((v) => v.testId === t.id);
              const testHeals = heals.filter((h) => h.testId === t.id);

              return (
                <li
                  key={t.id}
                  className="animate-stream-in px-4 py-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <StatusGlyph status={status} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[13px] leading-snug",
                          status === "pending" ? "text-base-500" : "text-base-200",
                        )}
                      >
                        {t.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-mono text-[10px] text-base-600">
                          {t.file}
                        </span>
                        <span
                          className="font-mono text-[10px] text-ok-400/70"
                          title="Locators verified against the live page"
                        >
                          ⌖ {t.selectorsVerified}/{t.selectorsTotal}
                        </span>
                        {result?.durationMs ? (
                          <span className="font-mono text-[10px] text-base-600">
                            {formatDuration(result.durationMs)}
                          </span>
                        ) : null}
                        {result && result.attempt > 1 ? (
                          <span className="font-mono text-[10px] text-ember-400">
                            attempt {result.attempt}
                          </span>
                        ) : null}
                      </div>

                      {result?.error ? (
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded border border-danger-500/20 bg-danger-500/6 px-2 py-1.5 font-mono text-[10px] leading-4 text-danger-400/90">
                          {result.error}
                        </pre>
                      ) : null}

                      {verdict ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge tone={TRIAGE_META[verdict.verdict].tone}>
                            {TRIAGE_META[verdict.verdict].label}
                          </Badge>
                          <span className="text-[11px] text-base-500">
                            {TRIAGE_META[verdict.verdict].action} ·{" "}
                            {Math.round(verdict.confidence * 100)}% confident
                          </span>
                        </div>
                      ) : null}

                      {testHeals.map((h) => (
                        <div
                          key={`${h.testId}-${h.attempt}`}
                          className={cn(
                            "mt-1.5 rounded border px-2 py-1.5",
                            h.outcome === "rejected"
                              ? "border-danger-500/25 bg-danger-500/6"
                              : "border-ember-600/25 bg-ember-600/6",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              tone={h.outcome === "rejected" ? "danger" : "ember"}
                            >
                              heal #{h.attempt} · {h.outcome}
                            </Badge>
                            {!h.assertionsIntact && (
                              <span className="text-[10px] font-medium text-danger-400">
                                assertion guard tripped
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-base-500">
                            {h.summary}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function StatusGlyph({ status }: { status: TestStatus }) {
  const map: Record<TestStatus, { char: string; cls: string }> = {
    passed: { char: "✓", cls: "border-ok-500/40 bg-ok-500/12 text-ok-400" },
    healed: { char: "⟲", cls: "border-ember-500/40 bg-ember-600/12 text-ember-400" },
    failed: { char: "✕", cls: "border-danger-500/40 bg-danger-500/12 text-danger-400" },
    quarantined: {
      char: "◧",
      cls: "border-violet-500/40 bg-violet-500/12 text-violet-500",
    },
    running: { char: "▸", cls: "border-info-500/40 bg-info-500/12 text-info-500" },
    pending: { char: "·", cls: "border-base-800 bg-base-850 text-base-600" },
  };
  const { char, cls } = map[status];
  return (
    <span
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none",
        cls,
      )}
      title={status}
    >
      {char}
    </span>
  );
}
