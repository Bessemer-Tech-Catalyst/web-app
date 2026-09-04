import { Launcher } from "@/components/launcher/launcher";
import { Wordmark } from "@/components/brand";
import { Badge } from "@/components/ui/primitives";

export default function Home() {
  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <Wordmark subtitle="Test orchestration" />
        <Badge>Phase 1 · simulated run</Badge>
      </header>
      <Launcher />
    </main>
  );
}
