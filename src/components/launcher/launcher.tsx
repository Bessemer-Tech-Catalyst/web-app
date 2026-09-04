"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Card, Dot } from "@/components/ui/primitives";
import { DEFAULT_RUN_OPTIONS, type RunInput, type RunOptions } from "@/lib/types";
import { cn } from "@/lib/format";
import { newRunId, saveDraft } from "@/lib/run-draft";

const PRESETS = [
  { label: "ShopLite", url: "https://shoplite.demo", note: "our demo target — auth, cart, checkout, admin" },
  { label: "TodoMVC", url: "https://demo.playwright.dev/todomvc", note: "Playwright's own demo app" },
  { label: "SauceDemo", url: "https://www.saucedemo.com", note: "classic QA sandbox" },
];

export function Launcher() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("");
  const [prd, setPrd] = useState<{ filename: string; text: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<RunOptions>(DEFAULT_RUN_OPTIONS);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function normalise(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      return new URL(withScheme).toString();
    } catch {
      return null;
    }
  }

  function launch(e: React.FormEvent) {
    e.preventDefault();
    const normalised = normalise(url);
    if (!normalised) {
      setError("That doesn't look like a URL. Try something like shoplite.demo");
      return;
    }
    const input: RunInput = {
      url: normalised,
      intent: intent.trim() || undefined,
      prd: prd ?? undefined,
      credentials: username ? { username, password } : undefined,
      options,
    };
    const id = newRunId();
    saveDraft(id, input);
    router.push(`/runs/${id}`);
  }

  async function onPrdFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setPrd({ filename: file.name, text });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-24">
      {/* ---- hero ---- */}
      <div className="relative pt-10 pb-10 text-center sm:pt-16">
        <div className="grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-72" />
        <Badge tone="ember" className="mx-auto">
          <Dot tone="ember" /> Autonomous test orchestration
        </Badge>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight text-base-100 sm:text-5xl">
          Give it a URL.
          <br className="hidden sm:block" />{" "}
          <span className="bg-gradient-to-br from-ember-300 to-ember-600 bg-clip-text text-transparent">
            Get a test suite that tells the truth.
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-base-400 sm:text-base">
          The Odyssey plans, grades its own plan, generates Playwright tests with every
          selector proven on the live page, runs them, works out whether a failure is a
          broken script or a broken app, heals only what it should — and tells you what
          it never got to.
        </p>
      </div>

      {/* ---- launcher form ---- */}
      <form onSubmit={launch}>
        <Card className="overflow-hidden shadow-2xl shadow-black/40">
          <div className="border-b border-base-800 p-4 sm:p-5">
            <label
              htmlFor="target-url"
              className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-base-500"
            >
              Target URL — the only thing that's required
            </label>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center font-mono text-sm text-base-600">
                  ↳
                </span>
                <input
                  id="target-url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="shoplite.demo"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!error}
                  aria-describedby={error ? "url-error" : undefined}
                  className={cn(
                    "w-full rounded-lg border bg-base-950/80 py-3 pl-9 pr-3 font-mono text-sm text-base-100 placeholder:text-base-600",
                    error ? "border-danger-500/60" : "border-base-800",
                  )}
                />
              </div>
              <button
                type="submit"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-ember-500 px-6 py-3 text-sm font-semibold text-base-950 transition hover:bg-ember-400 active:scale-[0.99]"
              >
                Run the pipeline
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
            </div>
            {error ? (
              <p id="url-error" className="mt-2 text-xs text-danger-400">
                {error}
              </p>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-base-600">Try:</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    title={p.note}
                    onClick={() => {
                      setUrl(p.url);
                      setError(null);
                    }}
                    className="rounded-md border border-base-800 bg-base-850/60 px-2 py-0.5 text-xs text-base-400 transition hover:border-base-700 hover:text-base-200"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- optional inputs ---- */}
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <div>
              <label
                htmlFor="intent"
                className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-base-500"
              >
                Intent <Badge>optional</Badge>
              </label>
              <textarea
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                rows={3}
                placeholder="focus on checkout and authentication flows"
                className="w-full resize-none rounded-lg border border-base-800 bg-base-950/80 px-3 py-2.5 text-sm text-base-100 placeholder:text-base-600"
              />
              <p className="mt-1.5 text-xs text-base-600">
                Plain English. It steers the planner's scope and priorities.
              </p>
            </div>

            <div>
              <label className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-base-500">
                Product requirements <Badge>optional</Badge>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.markdown"
                className="sr-only"
                onChange={(e) => onPrdFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex h-[86px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm transition",
                  prd
                    ? "border-ok-500/40 bg-ok-500/6 text-ok-400"
                    : "border-base-800 bg-base-950/50 text-base-500 hover:border-base-700 hover:text-base-300",
                )}
              >
                {prd ? (
                  <>
                    <span className="font-mono text-xs">{prd.filename}</span>
                    <span className="text-xs text-base-500">
                      {prd.text.length.toLocaleString()} chars · click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <span>Drop a PRD</span>
                    <span className="text-xs text-base-600">.md or .txt</span>
                  </>
                )}
              </button>
              <p className="mt-1.5 text-xs text-base-600">
                Unlocks requirement-by-requirement gap analysis in the report.
              </p>
            </div>
          </div>

          {/* ---- advanced ---- */}
          <div className="border-t border-base-800">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="flex w-full items-center justify-between px-4 py-3 text-xs text-base-500 transition hover:text-base-300 sm:px-5"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block transition-transform",
                    advanced && "rotate-90",
                  )}
                >
                  ›
                </span>
                Credentials &amp; budget
              </span>
              <span className="font-mono text-[11px] text-base-600">
                {options.maxScenarios} scenarios · {options.parallelWorkers} workers · $
                {options.budgetUsd} cap
              </span>
            </button>

            {advanced ? (
              <div className="animate-stream-in grid gap-4 border-t border-base-800 p-4 sm:grid-cols-2 sm:p-5">
                <div className="space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-base-500">
                    Sign-in (so recon can get past the login wall)
                  </p>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username or email"
                    autoComplete="off"
                    className="w-full rounded-lg border border-base-800 bg-base-950/80 px-3 py-2 font-mono text-xs text-base-100 placeholder:text-base-600"
                  />
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    placeholder="password"
                    autoComplete="off"
                    className="w-full rounded-lg border border-base-800 bg-base-950/80 px-3 py-2 font-mono text-xs text-base-100 placeholder:text-base-600"
                  />
                  <p className="text-xs text-base-600">
                    Held for the run only, redacted from every log line and never sent to
                    the model in plain text.
                  </p>
                </div>

                <div className="space-y-3.5">
                  <Slider
                    label="Max scenarios"
                    value={options.maxScenarios}
                    min={5}
                    max={40}
                    onChange={(v) => setOptions((o) => ({ ...o, maxScenarios: v }))}
                  />
                  <Slider
                    label="Parallel workers"
                    value={options.parallelWorkers}
                    min={1}
                    max={12}
                    onChange={(v) => setOptions((o) => ({ ...o, parallelWorkers: v }))}
                  />
                  <Slider
                    label="Re-plan budget"
                    value={options.maxReplans}
                    min={0}
                    max={4}
                    onChange={(v) => setOptions((o) => ({ ...o, maxReplans: v }))}
                  />
                  <Slider
                    label="Spend cap"
                    value={options.budgetUsd}
                    min={1}
                    max={25}
                    format={(v) => `$${v}`}
                    onChange={(v) => setOptions((o) => ({ ...o, budgetUsd: v }))}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </form>

      {/* ---- what makes it different ---- */}
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            n: "01",
            t: "It grades its own plan",
            d: "Scores coverage on a fixed rubric and re-plans when it's too thin. Judgment, before generation.",
          },
          {
            n: "02",
            t: "No unproven selectors",
            d: "Every locator resolves on the live page or the scenario is quarantined with a reason.",
          },
          {
            n: "03",
            t: "Broken test vs. broken app",
            d: "Classifies each failure on real evidence. Real bugs are filed, never healed away.",
          },
          {
            n: "04",
            t: "It reports what it missed",
            d: "Untested surfaces ranked by risk — the coverage nobody else shows you.",
          },
        ].map((f) => (
          <Card key={f.n} className="p-4">
            <div className="font-mono text-[11px] text-ember-500">{f.n}</div>
            <h3 className="mt-2 text-sm font-semibold text-base-100">{f.t}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-base-500">{f.d}</p>
          </Card>
        ))}
      </div>

      <p className="mt-10 text-center text-xs text-base-600">
        Looking for something you already ran?{" "}
        <Link href="/runs" className="text-ember-400 hover:text-ember-300">
          Past runs →
        </Link>
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = `slider-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs text-base-400">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-base-200">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-base-800 accent-ember-500"
      />
    </div>
  );
}
