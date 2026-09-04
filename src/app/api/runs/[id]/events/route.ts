import { isValidRunId } from "@/server/paths";
import { subscribe, TERMINATOR } from "@/server/run-store";
import type { OrchestratorEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The live event stream: replay from `?from=` (or `Last-Event-ID`), then tail.
 *
 * SSE rather than a WebSocket because the traffic is one-way, the browser reconnects
 * and resumes on its own, and the whole stream is just the run's ndjson read back —
 * which is also what makes offline demo replay free.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidRunId(id)) return new Response("Unknown run", { status: 404 });

  const explicit = new URL(req.url).searchParams.get("from");
  // `Last-Event-ID` is the last seq we delivered, so an automatic browser reconnect
  // resumes at the one after it; an explicit `?from=` is taken as given.
  const lastEventId = req.headers.get("last-event-id");
  const from = num(explicit) ?? (num(lastEventId) !== undefined ? num(lastEventId)! + 1 : 0);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already torn down by the client disconnecting.
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const onEvent = (ev: OrchestratorEvent) => {
        if (ev === TERMINATOR) {
          send("event: end\ndata: {}\n\n");
          close();
          return;
        }
        send(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      };

      // Proxies love to buffer text/event-stream; a comment frame up front and a
      // periodic ping keep the connection visibly alive through them.
      send(": open\n\n");
      heartbeat = setInterval(() => send(": ping\n\n"), 15_000);

      req.signal.addEventListener("abort", close, { once: true });
      unsubscribe = await subscribe(id, from, onEvent);
      if (req.signal.aborted) close();
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function num(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
