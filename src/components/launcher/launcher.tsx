"use client";

import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Section, Dot } from "@/components/ui/primitives";
import { DEFAULT_RUN_OPTIONS, type RunInput, type RunOptions } from "@/lib/types";
import { cn } from "@/lib/format";
import { startRun } from "@/lib/run-client";
import { DictateButton } from "./dictate-button";

// three.js is dead weight until the hero paints — and it needs a DOM, so no SSR pass.
const HeroCanvas = dynamic(
  () => import("./hero-canvas").then((m) => m.HeroCanvas),
  { ssr: false },
);

/**
 * Targets worth one click. ShopLite is deliberately not here: it is served by this same
 * process, so its URL depends on the port this server came up on and cannot be a constant.
 * It used to be `https://shoplite.demo`, a domain that does not exist — a run started from
 * that button died at Recon, in front of whoever pressed it. The demo button below asks
 * the server for its own origin instead.
 */
const PRESETS = [
  { label: "TodoMVC", url: "https://demo.playwright.dev/todomvc", note: "Playwright's own demo app" },
  { label: "SauceDemo", url: "https://www.saucedemo.com", note: "classic QA sandbox" },
];

interface DemoPreset {
  url: string;
  intent: string;
  credentials: { username: string; password: string };
  prd: { filename: string; text: string } | null;
  options: RunOptions;
  warning?: string;
}

export function Launcher() {
  const router = useRouter();
  // Set by a card on the Projects page: `?url=` prefills the field, `?demo=1` runs the
  // ShopLite fill outright — the bundled demo's real URL depends on the port this
  // server came up on, so it cannot be put in a link.
  const query = useSearchParams();
  const [url, setUrl] = useState(query.get("url") ?? "");
  const [intent, setIntent] = useState("");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [prd, setPrd] = useState<{ filename: string; text: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<RunOptions>(DEFAULT_RUN_OPTIONS);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
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

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    if (starting) return;
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
    // The server owns the run id: it scaffolds the workspace and starts the
    // orchestrator before answering, so the console has something to stream from
    // the moment it mounts.
    setStarting(true);
    try {
      const id = await startRun(input);
      router.push(`/runs/${id}`);
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : "Could not start the run");
    }
  }

  /**
   * Fill every field with the bundled ShopLite demo, in one click.
   *
   * The values come from the server rather than from a constant here, for the two things
   * a constant gets wrong: the port this server is actually on, and the PRD — which is
   * read from `docs/shoplite-prd.md`, the same file a judge is invited to check a quote
   * against. See `app/api/demo/preset/route.ts`.
   */
  async function fillDemo() {
    if (filling || starting) return;
    setFilling(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/preset");
      if (!response.ok) throw new Error(`The demo preset endpoint answered ${response.status}`);
      const preset = (await response.json()) as DemoPreset;

      setUrl(preset.url);
      setIntent(preset.intent);
      setUsername(preset.credentials.username);
      setPassword(preset.credentials.password);
      setPrd(preset.prd);
      setOptions(preset.options);
      // Opened on purpose: the button has just filled in a password and a spend cap, and
      // a form that quietly changes fields nobody can see is worse than one that does not.
      setAdvanced(true);
      setFilled(
        preset.warning ??
          `Filled from ${preset.url} — credentials, intent, ${preset.prd?.filename ?? "no PRD"} and a $${preset.options.budgetUsd.toFixed(2)} cap.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the demo preset");
    } finally {
      setFilling(false);
    }
  }

  /**
   * `?demo=1` fills the form the moment the page mounts. Guarded by a ref rather than
   * by the effect's dependencies, because a Strict Mode double-mount would otherwise
   * fetch the preset twice, and deferred off the effect body because it is a request —
   * the effect starts it, it does not render from it.
   */
  const demoRequested = useRef(false);
  useEffect(() => {
    if (query.get("demo") !== "1" || demoRequested.current) return;
    demoRequested.current = true;
    void Promise.resolve().then(fillDemo);
    // `fillDemo` is re-created every render and is deliberately not a dependency: the
    // ref above already makes this run exactly once, so its identity cannot matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function onPrdFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setPrd({ filename: file.name, text });
  }

  return (
    <div className="w-full">
      {/* ---- hero ---- */}
      <div className="relative px-6 pt-32 pb-12 text-center sm:pt-40">
        <div className="grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-72" />
        <HeroCanvas className="hero-webgl pointer-events-none absolute top-0 left-1/2 -z-10 h-[150px] w-[min(1100px,124vw)] -translate-x-1/2 sm:h-[190px]" />
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
        <Section className="border-t border-base-850">
          <div className="border-b border-base-850 px-6 py-5">
            <label
              htmlFor="target-url"
              className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-base-500"
            >
              Target URL — the only thing that&apos;s required
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
                    setFilled(null);
                  }}
                  placeholder="demo.playwright.dev/todomvc"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!error}
                  aria-describedby={error ? "url-error" : undefined}
                  className={cn(
                    "w-full rounded-md border bg-base-950/80 py-3 pl-9 pr-3 font-mono text-sm text-base-100 placeholder:text-base-600",
                    error ? "border-danger-500/60" : "border-base-800",
                  )}
                />
              </div>
              <button
                type="submit"
                disabled={starting}
                className="group inline-flex items-center justify-center gap-2 rounded-md bg-ember-500 px-6 py-3 text-sm font-semibold text-base-950 transition hover:bg-ember-400 active:scale-[0.99] disabled:opacity-60"
              >
                {starting ? "Starting…" : "Run the pipeline"}
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
            </div>
            {error ? (
              <p id="url-error" className="mt-2 text-xs text-danger-400">
                {error}
              </p>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={fillDemo}
                  disabled={filling}
                  title="Target URL, sign-in, intent, PRD and a demo-sized budget — all of it"
                  className="inline-flex items-center gap-1.5 rounded-md border border-ember-500/40 bg-ember-500/10 px-2.5 py-1 text-xs font-medium text-ember-300 transition hover:border-ember-500/70 hover:bg-ember-500/15 hover:text-ember-200 disabled:opacity-60"
                >
                  <span aria-hidden>⚡</span>
                  {filling ? "Filling…" : "Fill the ShopLite demo"}
                </button>
                <span className="ml-1 text-xs text-base-600">or try:</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    title={p.note}
                    onClick={() => {
                      setUrl(p.url);
                      setError(null);
                      setFilled(null);
                    }}
                    className="rounded-md border border-base-800 bg-base-850/60 px-2 py-0.5 text-xs text-base-400 transition hover:border-base-700 hover:text-base-200"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {filled ? (
              <p className="mt-2 text-xs text-ok-400">{filled}</p>
            ) : null}
          </div>

          {/* ---- optional inputs ---- */}
          <div className="grid divide-y divide-base-850 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="px-6 py-5">
              <label
                htmlFor="intent"
                className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-base-500"
              >
                Intent <Badge>optional</Badge>
              </label>
              <div className="relative">
                <textarea
                  id="intent"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  rows={3}
                  placeholder="focus on checkout and authentication flows"
                  className="w-full resize-none rounded-md border border-base-800 bg-base-950/80 py-2.5 pl-3 pr-12 text-sm text-base-100 placeholder:text-base-600"
                />
                {/* Dictation lands *inside* the field it fills, so it reads as part of the
                    input rather than a second control with its own meaning. */}
                <DictateButton
                  className="absolute bottom-2.5 right-2.5"
                  onError={setDictationError}
                  onTranscript={(text) =>
                    // Append: someone who typed half a sentence and then spoke the rest
                    // should not lose the half they typed.
                    setIntent((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
                  }
                />
              </div>
              {/* A failed transcription replaces the hint rather than squeezing in beside
                  the mic — Sarvam's own messages are the useful ones and they are long. */}
              {dictationError ? (
                <p className="mt-1.5 text-xs text-danger-400">{dictationError}</p>
              ) : (
                <p className="mt-1.5 text-xs text-base-600">
                  Plain English, typed or spoken. It steers the planner&apos;s scope and
                  priorities.
                </p>
              )}
            </div>

            <div className="px-6 py-5">
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
                  "flex h-[86px] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm transition",
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
          <div className="border-t border-base-850">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="flex w-full items-center justify-between px-6 py-3.5 text-xs text-base-500 transition hover:text-base-300 sm:px-5"
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
                {options.budgetUsd.toFixed(2)} cap
              </span>
            </button>

            {advanced ? (
              <div className="animate-stream-in grid divide-y divide-base-850 border-t border-base-850 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="space-y-3 px-6 py-5">
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
                    Held for the run only and redacted from every log line. The Generator
                    is given them, because a signed-out test has to sign in — but what it
                    writes into the file is{" "}
                    <code className="font-mono text-base-500">process.env.ODYSSEY_PASSWORD</code>,
                    and any literal it writes anyway is rewritten before the file is saved.
                  </p>
                </div>

                <div className="space-y-3.5 px-6 py-5">
                  <Slider
                    label="Max scenarios"
                    value={options.maxScenarios}
                    min={3}
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
                    min={0.5}
                    max={25}
                    step={0.5}
                    format={(v) => `$${v.toFixed(2)}`}
                    onChange={(v) => setOptions((o) => ({ ...o, budgetUsd: v }))}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      </form>

      {/* ---- what makes it different ---- */}
      <div className="grid border-t border-base-850 sm:grid-cols-2 lg:grid-cols-4">
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
          <Section key={f.n} className="px-6 py-6 sm:border-r sm:border-base-850">
            <div className="font-mono text-[11px] text-ember-500">{f.n}</div>
            <h3 className="mt-2 text-sm font-semibold text-base-100">{f.t}</h3>
            <p className="mt-2 text-xs leading-relaxed text-base-500">{f.d}</p>
          </Section>
        ))}
      </div>

      <p className="px-6 py-8 text-center text-xs text-base-600">
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
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** The spend cap moves in halves; everything else is a whole number of things. */
  step?: number;
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
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-base-800 accent-ember-500"
      />
    </div>
  );
}
