"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

/**
 * Dictation that writes as you speak.
 *
 * Sarvam's speech-to-text is one-shot: it takes a clip and answers with a transcript, so
 * there is no socket to stream words out of. The live feel here comes from cutting the
 * recording at the pauses you already make. An AnalyserNode watches the input level; when
 * it has heard speech and then ~700ms of quiet, that segment is closed, sent, and appended
 * while the next one is already recording. Cutting on silence rather than on a timer is
 * what keeps words whole — a fixed four-second chop lands mid-syllable about as often as
 * not, and Saaras cannot recover the half-word on either side of the join.
 *
 * The same loop drives the level bars. They are written straight to the bars' transforms;
 * putting them in React state would re-render the launcher sixty times a second.
 */

type Phase = "idle" | "recording";

const BAR_COUNT = 4;

/** Root-mean-square level above which a frame counts as speech rather than room noise. */
const SPEECH_RMS = 0.035;
/** Quiet for this long, after real speech, closes the segment. */
const SILENCE_MS = 700;
/** Too short to be a word — usually a chair creak or a door. Not worth an API call. */
const MIN_SPEECH_MS = 350;
/** A backstop for someone who never pauses; Sarvam truncates a long clip silently. */
const MAX_SEGMENT_MS = 14000;

interface DictateButtonProps {
  /** Called for each finished phrase, in order. Appends — see the launcher. */
  onTranscript: (text: string) => void;
  /** Errors are reported upward so they can be shown full-width under the field. */
  onError?: (message: string | null) => void;
  className?: string;
}

export function DictateButton({ onTranscript, onError, className }: DictateButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  /** False once the speaker has pressed stop; the last segment still gets sent. */
  const activeRef = useRef(false);
  /** Did the segment now closing contain speech, or only room noise? */
  const hadSpeechRef = useRef(false);
  /** Uploads are chained so phrases land in the order they were spoken. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const report = useCallback((message: string | null) => onError?.(message), [onError]);

  /** Everything that must be released whether the clip was sent or abandoned. */
  const teardown = useCallback(() => {
    activeRef.current = false;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recorderRef.current = null;
  }, []);

  // A component that unmounts mid-recording must not leave the tab's mic light on.
  useEffect(() => teardown, [teardown]);

  async function send(blob: Blob, filename: string) {
    setPending((n) => n + 1);
    try {
      const form = new FormData();
      form.set("audio", blob, filename);
      const resp = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await resp.json()) as { transcript?: string; error?: string };
      if (!resp.ok) {
        report(data.error ?? `Transcription failed (${resp.status}).`);
        // A rejected clip means every following one is rejected the same way — a bad key,
        // an unsupported format. Stop rather than repeat the failure every few seconds.
        if (activeRef.current) {
          teardown();
          setPhase("idle");
        }
      } else if (data.transcript) {
        onTranscript(data.transcript);
      }
    } catch (err) {
      report((err as Error).message);
    } finally {
      setPending((n) => n - 1);
    }
  }

  /** Records one phrase. Closed by the level loop, then immediately reopened. */
  function startSegment(stream: MediaStream) {
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    hadSpeechRef.current = false;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      // Chrome reports `audio/webm;codecs=opus`, and Sarvam matches its allow-list against
      // the whole string — codecs parameter included — so it 400s on a container it
      // otherwise accepts. Send the bare type. (The route strips it again, for any client
      // that doesn't.)
      const base = (recorder.mimeType || "audio/webm").split(";")[0].trim();
      const blob = new Blob(chunks, { type: base });
      if (hadSpeechRef.current && blob.size > 0) {
        const name = `intent.${extensionFor(base)}`;
        queueRef.current = queueRef.current.then(() => send(blob, name));
      }
      if (activeRef.current && streamRef.current) startSegment(streamRef.current);
    };
    recorder.start();
  }

  async function start() {
    report(null);
    if (typeof MediaRecorder === "undefined") {
      report("This browser cannot record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no input device — they look the same from here, and all of
      // them are fixed in the browser's own permission UI.
      report("Microphone unavailable. Check the site's mic permission.");
      return;
    }
    streamRef.current = stream;
    activeRef.current = true;
    setPhase("recording");
    startSegment(stream);

    // --- level meter and pause detection ---
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const wave = new Uint8Array(analyser.frequencyBinCount);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);

    // Speech lives near the bottom of the spectrum; spreading the bars over the whole
    // range would leave half of them permanently flat.
    const lowBin = 2;
    const highBin = Math.floor(analyser.frequencyBinCount * 0.42);
    const perBar = Math.max(1, Math.floor((highBin - lowBin) / BAR_COUNT));

    let segmentStart = performance.now();
    let speechMs = 0;
    let lastLoudAt = segmentStart;
    let lastFrame = segmentStart;

    const tick = () => {
      const now = performance.now();
      const delta = now - lastFrame;
      lastFrame = now;

      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const s of wave) {
        const v = (s - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / wave.length);
      if (rms > SPEECH_RMS) {
        speechMs += delta;
        lastLoudAt = now;
        hadSpeechRef.current = speechMs >= MIN_SPEECH_MS;
      }

      analyser.getByteFrequencyData(spectrum);
      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = barsRef.current[i];
        if (!bar) continue;
        let peak = 0;
        const from = lowBin + i * perBar;
        for (let b = from; b < from + perBar; b++) peak = Math.max(peak, spectrum[b] ?? 0);
        bar.style.transform = `scaleY(${0.22 + Math.min(1, (peak / 255) * 1.6) * 0.78})`;
      }

      const spoke = speechMs >= MIN_SPEECH_MS;
      const paused = now - lastLoudAt >= SILENCE_MS;
      const overrun = now - segmentStart >= MAX_SEGMENT_MS;
      if ((spoke && paused) || overrun) {
        // `onstop` sends this segment and opens the next one on the same stream.
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        segmentStart = now;
        speechMs = 0;
        lastLoudAt = now;
      }

      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }

  function stop() {
    activeRef.current = false;
    // The tail of speech is in the open segment; `onstop` sends it before we release the
    // stream, and `activeRef` being false stops it reopening another.
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    teardown();
    setPhase("idle");
  }

  if (phase === "recording") {
    return (
      <span className={cn("flex items-center gap-1.5", className)}>
        <span
          className="flex h-7 items-center gap-0.75 rounded-md bg-base-800/80 px-2"
          aria-hidden
        >
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barsRef.current[i] = el;
              }}
              className="h-3.5 w-0.75 origin-center rounded-full bg-ember-300"
              style={{ transform: "scaleY(0.22)" }}
            />
          ))}
        </span>
        <button
          type="button"
          onClick={stop}
          aria-label="Stop dictating"
          title="Stop dictating"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-ember-500 text-base-950 transition hover:bg-ember-400"
        >
          <MicIcon />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      aria-label="Dictate with your voice"
      title="Dictate (Sarvam AI)"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-ember-400 transition hover:bg-ember-500/12 hover:text-ember-300",
        // A phrase can still be in flight after the last stop; say so quietly.
        pending > 0 && "animate-pulse text-ember-400",
        className,
      )}
    >
      <MicIcon />
    </button>
  );
}

/** Sarvam sniffs the filename as well as the type, so the two have to agree. */
function extensionFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}
