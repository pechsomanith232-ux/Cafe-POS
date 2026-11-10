"use client";

import { ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createCountAction } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all__";

export function StartCount({ branchId, categories }: { branchId: string; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [category, setCategory] = useState(ALL);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="w-44" aria-label="Count scope"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All items</SelectItem>
          {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createCountAction({ branchId, categoryId: category === ALL ? null : category });
            if (r.ok) router.push(`/inventory/counts/${r.data.id}`);
            else toast.error(r.error);
          })
        }
      >
        <ClipboardCheck /> Start count
      </Button>
    </div>
  );
}
