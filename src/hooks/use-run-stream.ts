"use client";

/**
 * Subscribes to a run's event stream and folds it into `RunState`.
 *
 * Phase 1 plays a scripted local run. Phase 2 swaps the body of `subscribe()` for an
 * EventSource against `/api/runs/:id/events` — the reducer, the state shape and every
 * component that consumes them stay exactly as they are.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildMockRun } from "@/lib/mock-run";
import {
  emptyRunState,
  reduceRun,
  type OrchestratorEvent,
  type RunInput,
  type RunState,
} from "@/lib/types";

export type Speed = 1 | 2 | 4;

export function useRunStream(runId: string, input: RunInput | null) {
  const [state, setState] = useState<RunState>(emptyRunState);
  const [speed, setSpeed] = useState<Speed>(1);
  const [done, setDone] = useState(false);

  const speedRef = useRef<Speed>(1);
  speedRef.current = speed;

  /** Set by skipToEnd so the in-flight playback loop stops overwriting state. */
  const skippedRef = useRef(false);

  const script = useMemo(
    () => (input ? buildMockRun(runId, input) : null),
    [runId, input],
  );

  useEffect(() => {
    if (!script) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let i = 0;

    skippedRef.current = false;
    setState(emptyRunState());
    setDone(false);

    const step = () => {
      if (cancelled || skippedRef.current || i >= script.length) {
        if (!cancelled && !skippedRef.current) setDone(true);
        return;
      }
      const { delayMs, event } = script[i++];
      timer = setTimeout(() => {
        if (cancelled || skippedRef.current) return;
        setState((prev) => reduceRun(prev, event));
        step();
      }, Math.max(16, delayMs / speedRef.current));
    };

    step();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [script]);

  /** Fast-forward: fold every remaining event immediately. Handy mid-demo. */
  const skipToEnd = useCallback(() => {
    if (!script) return;
    skippedRef.current = true;
    setState(
      script.reduce<RunState>(
        (acc, t) => reduceRun(acc, t.event as OrchestratorEvent),
        emptyRunState(),
      ),
    );
    setDone(true);
  }, [script]);

  return { state, speed, setSpeed, done, skipToEnd };
}
