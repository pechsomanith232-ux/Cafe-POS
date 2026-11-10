"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route error boundary: an unexpected error in a page shows this instead of a blank screen. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Server errors arrive without details; the digest matches the server log line.
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <TriangleAlert className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Nothing was lost. Try again, and if it keeps happening tell the owner{digest ? ` (error ${digest})` : ""}.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        {/* A full page load on purpose: it also clears whatever client state broke. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <Button variant="outline" asChild><a href="/">Go to start</a></Button>
      </div>
    </div>
  );
}
