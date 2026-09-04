/**
 * The demo console. Two switches, one page, no link to it from anywhere in ShopLite —
 * it is the operator's surface, not the application's, and a crawler that found it would
 * plan tests against it.
 *
 * The flow it exists for: run the pipeline against a healthy ShopLite, then flip one
 * switch between GENERATE and EXECUTE and let the judges watch what the classifier does
 * with the failure that follows.
 */

"use client";

import { useEffect, useState } from "react";
import type { Flags } from "../shop";

export default function ControlPage() {
  const [flags, setFlags] = useState<Flags | null>(null);

  useEffect(() => {
    fetch("/api/shoplite/flags")
      .then((r) => r.json() as Promise<Flags>)
      .then(setFlags)
      .catch(() => setFlags({ drift: false, defect: false }));
  }, []);

  async function toggle(key: keyof Flags) {
    if (!flags) return;
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    const response = await fetch("/api/shoplite/flags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    setFlags((await response.json()) as Flags);
  }

  return (
    <>
      <h1>Demo controls</h1>
      <p className="sl-lede">
        Not part of ShopLite. These break the application on purpose, so the pipeline has
        something real to classify.
      </p>

      <div className="sl-panel">
        <Toggle
          on={flags?.drift ?? false}
          onChange={() => toggle("drift")}
          title="Rename the add button"
          detail={
            "“Add to cart” becomes “Add to bag”. The application is completely healthy; a " +
            "test written before the flip cannot find the control. Expect SCRIPT_DRIFT and a heal."
          }
        />
        <Toggle
          on={flags?.defect ?? false}
          onChange={() => toggle("defect")}
          title="Break order history"
          detail={
            "GET /api/shoplite/orders returns 500. The order is still placed; the history page " +
            "cannot render it. Expect APP_DEFECT, a filed bug, and the Healer withheld."
          }
        />
      </div>
    </>
  );
}

function Toggle({
  on,
  onChange,
  title,
  detail,
}: {
  on: boolean;
  onChange: () => void;
  title: string;
  detail: string;
}) {
  return (
    <div style={{ paddingBottom: 14 }}>
      <label className="sl-toggle">
        <input type="checkbox" checked={on} onChange={onChange} />
        <strong>{title}</strong>
        <span className="sl-badge">{on ? "broken" : "healthy"}</span>
      </label>
      <p className="sl-note" style={{ margin: 0 }}>
        {detail}
      </p>
    </div>
  );
}
