import { notFound } from "next/navigation";
import { ReportView } from "@/components/report/report-view";
import { getRunState } from "@/server/run-store";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const state = await getRunState(id);
  if (!state) notFound();

  // The report is written by the orchestrator at the end of the run, so a run that
  // has not finished has nothing to show yet — the console is the live view.
  if (!state.report) {
    return (
      <main className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <p className="text-sm text-base-300">This run has not produced a report yet.</p>
          <p className="mt-1 text-xs text-base-500">
            Follow it live in the <a className="text-ember-400 underline" href={`/runs/${id}`}>console</a>.
          </p>
        </div>
      </main>
    );
  }

  return <ReportView runId={id} report={state.report} artifacts={state.artifacts} />;
}
