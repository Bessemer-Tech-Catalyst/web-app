import Link from "next/link";
import { OdysseyMark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-24 text-center">
      <OdysseyMark className="size-10 text-base-700" />
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-base-600">
        404 — off the map
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-base-100">
        Nothing charted at this route
      </h1>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-base-500">
        The page you asked for doesn&apos;t exist — or the run id has aged out of the
        local store.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Link
          href="/"
          className="rounded-md bg-ember-500 px-3.5 py-2 text-[13px] font-semibold text-base-950 transition hover:bg-ember-400"
        >
          Back to overview
        </Link>
        <Link
          href="/runs"
          className="rounded-lg border border-base-800 px-3.5 py-2 text-[13px] text-base-300 transition hover:border-base-700 hover:text-base-100"
        >
          Past runs
        </Link>
      </div>
    </div>
  );
}
