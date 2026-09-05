"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function RerunPage() {
  const router = useRouter();
  const params = useParams();
  const sourceRunId = params.id as string;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function rerun() {
      try {
        // Get the input from the source run
        const inputRes = await fetch(`/api/runs/${sourceRunId}/input`);
        if (!inputRes.ok) throw new Error("Failed to fetch run input");
        const { input } = await inputRes.json();

        // Create a new run with the same input
        const runRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!runRes.ok) throw new Error("Failed to create new run");
        const { id: newRunId } = await runRes.json();

        // Redirect to the new run
        router.push(`/runs/${newRunId}`);
      } catch (error) {
        console.error("Rerun failed:", error);
        setLoading(false);
      }
    }

    rerun();
  }, [sourceRunId, router]);

  return (
    <main className="flex h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-base-300">Creating a new run...</p>
        <p className="mt-1 text-xs text-base-500">
          {loading ? "Initializing test orchestration" : "Rerun failed"}
        </p>
      </div>
    </main>
  );
}
