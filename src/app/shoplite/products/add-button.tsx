"use client";

import { useState } from "react";
import { addToBasket } from "../basket";

/**
 * The add control. Its label is handed down from the server so the `drift` switch can
 * rename it, and the confirmation it shows afterwards is a second, differently-named
 * element — which gives a generated test something to assert beyond "the click happened".
 */
export function AddButton({ sku, label }: { sku: string; label: string }) {
  const [added, setAdded] = useState(0);

  return (
    <span className="sl-row" style={{ gap: 10 }}>
      {added > 0 ? <span className="sl-badge">{added} in basket</span> : null}
      <button
        className="sl-btn"
        type="button"
        onClick={() => setAdded(addToBasket(sku).find((l) => l.sku === sku)?.qty ?? 0)}
      >
        {label}
      </button>
    </span>
  );
}
