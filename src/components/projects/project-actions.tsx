"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Section } from "@/components/ui/primitives";
import { cn } from "@/lib/format";

// Mirrored rather than imported: `@/server/project-store` reaches for node:crypto and
// node:fs, and a client module must not pull that graph in even for a type.
type ProjectEnv = "production" | "staging" | "local";

/**
 * Add a project without running one.
 *
 * The registry fills itself from runs, which covers the common case; this covers the
 * other one — writing down an application you intend to cover before you have pointed
 * anything at it. It posts to `/api/projects` and refreshes the server component, so
 * the card that appears is read back from disk rather than faked in local state.
 */
export function AddProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [env, setEnv] = useState<ProjectEnv | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          name: name.trim() || undefined,
          env: env || undefined,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}`);
      setUrl("");
      setName("");
      setEnv("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
        <p className="text-xs text-base-500">
          Every run registers its project automatically. Add one here to write it down
          before the first run.
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-base-800 px-3 py-1.5 text-[13px] text-base-300 transition hover:border-base-700 hover:text-base-100"
        >
          {open ? "Cancel" : "Add project"}
        </button>
      </div>

      {open ? (
        <form
          onSubmit={submit}
          className="animate-stream-in grid gap-3 border-t border-base-850 px-6 py-4 sm:grid-cols-[2fr_1.2fr_auto_auto] sm:items-end"
        >
          <Field label="URL" htmlFor="project-url">
            <input
              id="project-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="staging.example.com/app"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "w-full rounded-md border bg-base-950/80 px-3 py-2 font-mono text-xs text-base-100 placeholder:text-base-600",
                error ? "border-danger-500/60" : "border-base-800",
              )}
            />
          </Field>

          <Field label="Name — optional" htmlFor="project-name">
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="derived from the URL"
              autoComplete="off"
              className="w-full rounded-md border border-base-800 bg-base-950/80 px-3 py-2 text-xs text-base-100 placeholder:text-base-600"
            />
          </Field>

          <Field label="Environment" htmlFor="project-env">
            <select
              id="project-env"
              value={env}
              onChange={(e) => setEnv(e.target.value as ProjectEnv | "")}
              className="w-full rounded-md border border-base-800 bg-base-950/80 px-3 py-2 text-xs text-base-200"
            >
              <option value="">detect</option>
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="local">local</option>
            </select>
          </Field>

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-ember-500 px-4 py-2 text-[13px] font-semibold text-base-950 transition hover:bg-ember-400 disabled:opacity-60"
          >
            {busy ? "Adding…" : "Add"}
          </button>

          {error ? (
            <p className="text-xs text-danger-400 sm:col-span-4">{error}</p>
          ) : null}
        </form>
      ) : null}
    </Section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-base-600"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Forgets a project. Its runs stay — they are the evidence. */
export function RemoveProject({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Remove ${name} from the project list? Its runs are kept.`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      title={`Remove ${name}`}
      aria-label={`Remove ${name}`}
      className="rounded-md px-1.5 py-0.5 text-xs text-base-600 transition hover:bg-base-850 hover:text-danger-400 disabled:opacity-50"
    >
      ✕
    </button>
  );
}
