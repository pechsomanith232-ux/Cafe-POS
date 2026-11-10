"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { switchBranch } from "@/app/(app)/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function BranchSwitcher({
  branchId,
  branches,
}: {
  branchId: string;
  branches: { id: string; code: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  if (branches.length <= 1) {
    const b = branches[0];
    return <div className="rounded-md border px-3 py-2 text-sm">{b ? `${b.code} · ${b.name}` : "—"}</div>;
  }
  return (
    <Select
      value={branchId}
      disabled={pending}
      onValueChange={(id) =>
        startTransition(async () => {
          const r = await switchBranch(id);
          if (!r.ok) toast.error(r.error);
        })
      }
    >
      <SelectTrigger className="w-full" aria-label="Branch">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.code} · {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
