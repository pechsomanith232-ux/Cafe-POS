import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Report title with the scope (branch, period) that also prints at the top of the page. */
export function ReportHeader({ title, description, scope }: { title: string; description?: string; scope: string }) {
  return (
    <div className="mb-4">
      <Link href="/reports" className="mb-1 inline-flex items-center text-sm text-muted-foreground hover:underline print:hidden"><ChevronLeft className="size-4" /> Reports</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{scope}</p>
      {description && <p className="text-sm text-muted-foreground print:hidden">{description}</p>}
    </div>
  );
}

export const fmtRange = (from: string, to: string) => (from === to ? from : `${from} – ${to}`);
