"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchBranch } from "@/app/[locale]/(app)/actions";
import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function BranchSwitcher({
  branchId,
  branches,
}: {
  branchId: string;
  branches: { id: string; code: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Nav");
  if (branches.length <= 1) {
    const b = branches[0];
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs">
        <Building2 className="size-4 text-muted-foreground" />
        <span className="truncate">{b ? `${b.code} · ${b.name}` : "—"}</span>
      </div>
    );
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
      <SelectTrigger className="w-full cursor-pointer bg-card transition-colors hover:bg-accent" aria-label={t("branch")}>
        <span className="flex min-w-0 items-center gap-2 truncate">
          <Building2 className="size-4 text-muted-foreground" />
          <SelectValue />
        </span>
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
