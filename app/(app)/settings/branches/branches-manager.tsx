"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { createBranchAction, setBranchActiveAction, updateBranchAction } from "@/app/(app)/settings/actions";
import { Field } from "@/components/shared/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { BranchRow } from "@/lib/queries/settings";
import { branchInput } from "@/lib/validators/settings";

type FormIn = z.input<typeof branchInput>;
type FormOut = z.output<typeof branchInput>;

export function BranchesManager({ branches }: { branches: BranchRow[] }) {
  const [editing, setEditing] = useState<BranchRow | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> New branch
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.code}</TableCell>
                <TableCell>{b.name}</TableCell>
                <TableCell>{b.phone ?? "—"}</TableCell>
                <TableCell>
                  {Number(b.taxRate) > 0 ? `${Number(b.taxRate)}% ${b.taxInclusive ? "incl." : "excl."}` : "Off"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={b.isActive}
                      disabled={pending}
                      aria-label={b.isActive ? "Deactivate branch" : "Activate branch"}
                      onCheckedChange={(on) =>
                        startTransition(async () => {
                          const r = await setBranchActiveAction(b.id, on);
                          if (r.ok) toast.success(on ? "Branch activated." : "Branch deactivated.");
                          else toast.error(r.error);
                        })
                      }
                    />
                    <Badge variant={b.isActive ? "secondary" : "outline"}>{b.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <BranchDialog branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function BranchDialog({ branch, onClose }: { branch: BranchRow | null; onClose: () => void }) {
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(branchInput),
    defaultValues: {
      code: branch?.code ?? "",
      name: branch?.name ?? "",
      address: branch?.address ?? "",
      phone: branch?.phone ?? "",
      receiptHeader: branch?.receiptHeader ?? "",
      receiptFooter: branch?.receiptFooter ?? "",
      taxRate: branch ? String(Number(branch.taxRate)) : "0",
      taxInclusive: branch?.taxInclusive ?? true,
    },
  });
  const errors = form.formState.errors;

  async function onSubmit(values: FormOut) {
    const r = branch ? await updateBranchAction(branch.id, values) : await createBranchAction(values);
    if (r.ok) {
      toast.success(branch ? "Branch saved." : "Branch created.");
      onClose();
    } else toast.error(r.error);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "New branch"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code" error={errors.code?.message}>
              <Input {...form.register("code")} placeholder="B2" />
            </Field>
            <div className="col-span-2">
              <Field label="Name" error={errors.name?.message}>
                <Input {...form.register("name")} placeholder="Riverside" />
              </Field>
            </div>
          </div>
          <Field label="Address">
            <Input {...form.register("address")} />
          </Field>
          <Field label="Phone">
            <Input {...form.register("phone")} />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Tax rate (%)" error={errors.taxRate?.message}>
              <Input {...form.register("taxRate")} inputMode="decimal" />
            </Field>
            <Controller
              control={form.control}
              name="taxInclusive"
              render={({ field }) => (
                <label className="flex h-9 items-center gap-2 text-sm">
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                  Prices include tax
                </label>
              )}
            />
          </div>
          <Field label="Receipt header">
            <Textarea rows={2} {...form.register("receiptHeader")} />
          </Field>
          <Field label="Receipt footer">
            <Textarea rows={2} {...form.register("receiptFooter")} placeholder="Thank you! Wi-Fi: …" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
