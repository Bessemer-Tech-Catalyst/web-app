import Link from "next/link";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardHeader, Stat, type Tone } from "@/components/ui/primitives";
import { DEFECTS, targetName } from "@/lib/mock-fleet";
import { formatRelative } from "@/lib/format";
import type { Priority } from "@/lib/types";

export const metadata = { title: "Defects — The Odyssey" };

const SEVERITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "warn",
  medium: "info",
  low: "neutral",
};

const STATUS_TONE: Record<string, Tone> = {
  open: "danger",
  triaged: "warn",
  fixed: "ok",
};

export default function DefectsPage() {
  const open = DEFECTS.filter((d) => d.status === "open");
  const critical = DEFECTS.filter((d) => d.severity === "critical");
  const avgConfidence =
    DEFECTS.reduce((n, d) => n + d.confidence, 0) / Math.max(1, DEFECTS.length);

  return (
    <>
      <PageHeader
        title="Defects"
        subtitle="Failures the classifier attributed to the application, not the script. These were filed, never healed away."
      />

      <PageBody className="space-y-5">
        <Card className="grid divide-y divide-base-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat label="Open" value={open.length} tone={open.length ? "danger" : "ok"} />
          <Stat label="Critical" value={critical.length} tone="danger" hint="Blocking a core flow" />
          <Stat
            label="Mean confidence"
            value={`${Math.round(avgConfidence * 100)}%`}
            tone="ember"
            hint="How sure the classifier was it's an app bug"
          />
        </Card>

        <Card>
          <CardHeader
            title="Filed by the classifier"
            subtitle="Each carries the evidence that separated it from script drift"
          />
          <div className="divide-y divide-base-800">
            {DEFECTS.map((d) => (
              <div key={d.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Badge tone={SEVERITY_TONE[d.severity]}>{d.severity}</Badge>
                    <div className="min-w-0">
                      <div className="text-[13px] leading-snug text-base-100">
                        {d.title}
                      </div>
                      <div className="mt-1 font-mono text-xs text-base-600">
                        {d.id} · {targetName(d.targetId)} · {d.surface} ·{" "}
                        {formatRelative(d.firstSeenAt)}
                        {d.occurrences > 1 ? ` · seen ${d.occurrences}×` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                    <Badge mono>{Math.round(d.confidence * 100)}%</Badge>
                    <Link
                      href={`/runs/${d.runId}`}
                      className="rounded-lg border border-base-800 px-3 py-1.5 text-xs text-base-300 transition hover:border-base-700 hover:text-base-100"
                    >
                      Run
                    </Link>
                  </div>
                </div>
                <p className="mt-2.5 rounded-lg border border-base-800 bg-base-950/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-base-400">
                  {d.evidence}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
