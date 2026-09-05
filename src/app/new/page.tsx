import { Suspense } from "react";
import { Launcher } from "@/components/launcher/launcher";

export const metadata = { title: "New run — The Odyssey" };

export default function NewRunPage() {
  // The launcher reads `?url=` and `?demo=1` off the query string, which is what a card
  // on the Projects page links to. Reading them needs a boundary to prerender behind.
  return (
    <Suspense>
      <Launcher />
    </Suspense>
  );
}
