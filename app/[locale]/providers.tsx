"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { Toaster } from "@/components/ui/sonner";

/**
 * Client-side providers. TanStack Query is used for data that must refresh
 * live (kitchen queue every 3 s, low-stock badge every 30 s; plan §1).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser tab, created once.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
