"use client";

import { Check, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/app/(app)/settings/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RoleRow } from "@/lib/queries/settings";

type CatalogEntry = { key: string; description: string; hasLimit: boolean };

const GROUP_LABELS: Record<string, string> = {
  pos: "POS", shift: "Shifts", inventory: "Inventory", menu: "Menu", purchasing: "Purchasing",
  customers: "Customers", ar: "Customers", reports: "Reports", settings: "Settings", users: "Settings",
  roles: "Settings", audit: "Settings",
};

function grouped(catalog: CatalogEntry[]) {
  const groups = new Map<string, CatalogEntry[]>();
  for (const p of catalog) {
    const g = GROUP_LABELS[p.key.split(".")[0]] ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return [...groups];
}

const isLocked = (r: RoleRow) => r.isSystem && r.name === "Owner";

export function RolesManager({ roles, catalog }: { roles: RoleRow[]; catalog: CatalogEntry[] }) {
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const groups = grouped(catalog);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}><Plus /> New role</Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 min-w-64 bg-background">Permission</TableHead>
              {roles.map((r) => (
                <TableHead key={r.id} className="min-w-28 text-center">
                  <div className="flex flex-col items-center gap-1 py-1">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="text-xs">{r.userCount} user{r.userCount === 1 ? "" : "s"}</span>
                    {isLocked(r) ? (
                      <Lock className="size-4" aria-label="Locked" />
                    ) : (
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        {!r.isSystem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Delete ${r.name}`}
                            disabled={pending}
                            onClick={() =>
                              confirm(`Delete the role "${r.name}"?`) &&
                              startTransition(async () => {
                                const res = await deleteRoleAction(r.id);
                                if (res.ok) toast.success("Role deleted.");
                                else toast.error(res.error);
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, perms]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={roles.length + 1} className="sticky left-0 text-xs font-semibold uppercase">{group}</TableCell>
                </TableRow>
                {perms.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="sticky left-0 bg-background">
                      <div className="text-sm">{p.description}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.key}</div>
                    </TableCell>
                    {roles.map((r) => {
                      const has = p.key in r.permissions;
                      const limit = r.permissions[p.key];
                      return (
                        <TableCell key={r.id} className="text-center">
                          {has ? (
                            limit != null ? <span className="text-sm">≤ {Number(limit)}%</span> : <Check className="mx-auto size-4" aria-label="Allowed" />
                          ) : (
                            <span className="text-muted-foreground">·</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <RoleDialog role={editing === "new" ? null : editing} groups={groups} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function RoleDialog({
  role,
  groups,
  onClose,
}: {
  role: RoleRow | null;
  groups: [string, CatalogEntry[]][];
  onClose: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [selected, setSelected] = useState<Record<string, string | null>>(role ? { ...role.permissions } : {});
  const [saving, setSaving] = useState(false);

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = { ...s };
      if (on) next[key] = null;
      else delete next[key];
      return next;
    });

  async function save() {
    setSaving(true);
    const input = {
      name,
      permissions: Object.entries(selected).map(([key, limit]) => ({ key, limit: limit === "" ? null : limit })),
    };
    const r = role ? await updateRoleAction(role.id, input) : await createRoleAction(input);
    setSaving(false);
    if (r.ok) {
      toast.success("Role saved.");
      onClose();
    } else toast.error(r.error);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
        </DialogHeader>
        <Field label="Role name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={role?.isSystem} />
        </Field>
        <div className="grid gap-4">
          {groups.map(([group, perms]) => (
            <div key={group}>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{group}</div>
              <div className="grid gap-2">
                {perms.map((p) => (
                  <div key={p.key} className="flex items-center gap-2 text-sm">
                    <Checkbox id={`perm-${p.key}`} checked={p.key in selected} onCheckedChange={(v) => toggle(p.key, v === true)} />
                    <label htmlFor={`perm-${p.key}`} className="flex-1">{p.description}</label>
                    {p.hasLimit && p.key in selected && (
                      <Input
                        aria-label="Limit (%)"
                        className="h-8 w-20"
                        inputMode="decimal"
                        placeholder="max %"
                        value={selected[p.key] == null ? "" : String(Number(selected[p.key]))}
                        onChange={(e) => setSelected((s) => ({ ...s, [p.key]: e.target.value || null }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>Save role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
