"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "View" button showing the before/after JSON of an audit entry. */
export function AuditDetails({ before, after }: { before: unknown; after: unknown }) {
  const [open, setOpen] = useState(false);
  if (before == null && after == null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>View</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Change details</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Before</div>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(before, null, 2) ?? "—"}</pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">After</div>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(after, null, 2) ?? "—"}</pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
