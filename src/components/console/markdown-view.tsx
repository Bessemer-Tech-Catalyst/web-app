"use client";

/**
 * A markdown renderer for the documents this app writes about itself.
 *
 * A run's plan and its report are markdown files on disk, and until this existed the only
 * way to read one was to open it in a browser tab as `text/markdown` — which is to say, as
 * raw asterisks and pipe characters. The artifact route serves them sandboxed with
 * `default-src 'none'`, so a tab cannot even style them.
 *
 * Deliberately small, and deliberately not a general markdown implementation: it covers
 * what `spec-format.ts` and `report-markdown.ts` actually emit — headings, tables, fenced
 * code, block quotes, both kinds of list, and inline bold/italic/code/links. Anything it
 * does not recognise falls through as a paragraph, which is legible rather than wrong.
 *
 * Nothing here goes near `dangerouslySetInnerHTML`. Every node is a React element, so a
 * document containing `<script>` renders those characters instead of running them — and
 * these documents are written by models from pages the run was pointed at, which makes
 * that the difference between a viewer and an injection.
 */

import { Fragment, useEffect, useState, type ReactNode } from "react";

/**
 * The markdown viewer as an overlay: a plan or a report opens here instead of in a tab.
 * It fetches the file itself rather than being handed the text, because the rail knows
 * only what the run wrote and where — never the contents.
 */
export function MarkdownSheet({
  href,
  title,
  subtitle,
  onClose,
}: {
  href: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Aborted on close so a slow file cannot land in a viewer that has already gone, or
    // in the *next* one the reader opened. There is no state to reset first: the caller
    // keys this component by href, so a second document mounts a second sheet rather than
    // showing the first one's text under the second one's title.
    const ac = new AbortController();
    fetch(href, { signal: ac.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setText)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ac.abort();
  }, [href]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-950/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        // The backdrop closes; the sheet must not, or selecting a line of the document
        // dismisses the document.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-base-800 bg-base-900 shadow-2xl"
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-base-850 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold text-base-100">{title}</h2>
            {subtitle ? (
              <p className="truncate font-mono text-[10px] text-base-600">{subtitle}</p>
            ) : null}
          </div>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-base-800 px-2.5 py-1 text-[11px] text-base-400 transition hover:border-base-700 hover:text-base-100"
          >
            Raw ↗
          </a>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md border border-base-800 px-2.5 py-1 text-[11px] text-base-400 transition hover:border-base-700 hover:text-base-100"
          >
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-xs text-danger-400">Could not read this file — {error}</p>
          ) : text === null ? (
            <p className="text-xs text-base-500">Reading…</p>
          ) : (
            <MarkdownView text={text} />
          )}
        </div>
      </div>
    </div>
  );
}

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-base-300">
      {blocks(text.split("\n"))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function blocks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `b${i}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code. The closing fence is optional: a truncated file should still render
    // the code it does have rather than swallowing the rest of the document.
    if (line.trimStart().startsWith("```")) {
      const start = i;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(
        <pre
          key={`b${start}`}
          className="overflow-x-auto rounded-md border border-base-850 bg-base-950 p-3 font-mono text-[11px] leading-5 text-base-300"
        >
          {body.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const size =
        level === 1
          ? "text-base font-semibold text-base-100"
          : level === 2
            ? "text-[13px] font-semibold text-base-100"
            : "text-[12px] font-semibold uppercase tracking-wide text-base-400";
      out.push(
        <p key={key()} className={`${size} ${level > 1 ? "pt-2" : ""}`}>
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key()} className="border-base-850" />);
      i++;
      continue;
    }

    // Table: a header row, a separator of dashes, then rows until the block ends.
    if (line.includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? "")) {
      const start = i;
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) rows.push(cells(lines[i++]));
      out.push(
        <div key={`b${start}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {head.map((c, n) => (
                  <th
                    key={n}
                    className="border-b border-base-800 px-2 py-1.5 text-left font-medium text-base-400"
                  >
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((c, m) => (
                    <td
                      key={m}
                      className="border-b border-base-850 px-2 py-1.5 align-top text-base-300"
                    >
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const start = i;
      const body: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        body.push(lines[i++].replace(/^\s*>\s?/, ""));
      }
      out.push(
        <blockquote
          key={`b${start}`}
          className="border-l-2 border-ember-500/60 bg-base-900/40 px-3 py-2 text-base-400"
        >
          {inline(body.join(" "))}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const start = i;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List
          key={`b${start}`}
          className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-base-600`}
        >
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // A paragraph runs to the next blank line, so a sentence wrapped across three source
    // lines renders as one sentence rather than three.
    const start = i;
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    if (para.length === 0) para.push(lines[i++]);
    out.push(<p key={`b${start}`}>{inline(para.join(" "))}</p>);
  }

  return out;
}

const isBlockStart = (line: string) =>
  /^\s*(#{1,6}\s|>|[-*]\s|\d+\.\s|```)/.test(line) || /^\s*([-*_])\1{2,}\s*$/.test(line);

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/** `**bold**`, `_italic_`, `` `code` ``, `[text](href)` — one pass, no nesting. */
const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    const k = `i${at}`;
    if (token.startsWith("**")) {
      out.push(
        <strong key={k} className="font-semibold text-base-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code key={k} className="rounded bg-base-850 px-1 py-0.5 font-mono text-[11px] text-base-200">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("_")) {
      out.push(
        <em key={k} className="text-base-400">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link?.[2] ?? "";
      // Only http(s) and in-app paths are turned into links. A `javascript:` href in a
      // document an agent wrote from a page it crawled is exactly the thing this viewer
      // must not hand a click to, so anything else renders as its own text.
      const safe = /^(https?:\/\/|\/)/i.test(href);
      out.push(
        safe ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-info-500 underline decoration-info-500/40 underline-offset-2 hover:decoration-info-500"
          >
            {link?.[1]}
          </a>
        ) : (
          <Fragment key={k}>{token}</Fragment>
        ),
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
