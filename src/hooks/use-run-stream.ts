"use client";

/**
 * Subscribes to a run's server-sent event stream and folds it into `RunState`.
 *
 * The transport is deliberately thin: the server replays the run's event log from the
 * last sequence we saw and then tails it live, so a reload, a dropped connection or a
 * server restart all resume losslessly through the same path. `reduceRun` — the same
 * reducer the server uses to build the report — does the rest.
 */

import { useEffect, useRef, useState } from "react";
import {
  emptyRunState,
  reduceRun,
  type OrchestratorEvent,
  type RunState,
} from "@/lib/types";

export type StreamStatus = "connecting" | "live" | "ended" | "error";

export function useRunStream(runId: string) {
  const [state, setState] = useState<RunState>(emptyRunState);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  /** Survives reconnects so we resume rather than replay from zero. */
  const lastSeq = useRef(-1);

  // Navigating from one run to another reuses this hook, so the fold has to be
  // reset during render rather than in an effect — otherwise the new run's first
  // events would land on top of the previous run's state.
  const [subscribed, setSubscribed] = useState(runId);
  if (subscribed !== runId) {
    setSubscribed(runId);
    setState(emptyRunState());
    setStatus("connecting");
  }

  useEffect(() => {
    lastSeq.current = -1;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const from = lastSeq.current + 1;
      source = new EventSource(`/api/runs/${runId}/events?from=${from}`);

      source.onopen = () => setStatus("live");

      source.onmessage = (e) => {
        let ev: OrchestratorEvent;
        try {
          ev = JSON.parse(e.data) as OrchestratorEvent;
        } catch {
          return;
        }
        // The server can only guarantee ordering, not exactly-once across a
        // reconnect that raced the watermark. Drop anything we already folded.
        if (ev.seq <= lastSeq.current) return;
        lastSeq.current = ev.seq;
        setState((prev) => reduceRun(prev, ev));
      };

      // The run is over — the server says so explicitly rather than hanging up,
      // so we can tell "finished" apart from "connection dropped".
      source.addEventListener("end", () => {
        cancelled = true;
        source?.close();
        setStatus("ended");
      });

      source.onerror = () => {
        source?.close();
        if (cancelled) return;
        setStatus("error");
        retry = setTimeout(connect, 1_500);
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [runId]);

  return { state, status, done: status === "ended" };
}
