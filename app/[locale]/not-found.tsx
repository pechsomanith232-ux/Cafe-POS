import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <FileQuestion className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">It may have been removed, or the link is wrong.</p>
      <Button asChild><Link href="/">Go to start</Link></Button>
    </div>
  );
}
