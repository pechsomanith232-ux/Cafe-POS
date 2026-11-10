"use client";

import { useEffect } from "react";

/** Opens the browser's print dialog once the page has rendered (receipts, X/Z reports). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [enabled]);
  return null;
}
