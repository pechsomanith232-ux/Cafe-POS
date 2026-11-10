"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { createSupplierAction, updateSupplierAction } from "@/app/(app)/purchasing/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supplierInput } from "@/lib/validators/purchasing";

type In = z.input<typeof supplierInput>;
type Out = z.output<typeof supplierInput>;
export type SupplierFormValue = { id: string; isActive: boolean } & In;

export function SupplierDialog({ supplier, onClose }: { supplier: SupplierFormValue | null; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(supplierInput),
    defaultValues: supplier ?? { name: "", contactName: "", phone: "", email: "", address: "", paymentTermsDays: 0, note: "" },
  });
  const e = form.formState.errors;
  async function onSubmit(values: Out) {
    const r = supplier ? await updateSupplierAction(supplier.id, { ...values, isActive: supplier.isActive }) : await createSupplierAction(values);
    if (!r.ok) return void toast.error(r.error);
    toast.success(supplier ? "Supplier saved." : "Supplier added.");
    onClose();
    router.refresh();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
          <Field label="Name" error={e.name?.message}><Input {...form.register("name")} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person"><Input {...form.register("contactName")} /></Field>
            <Field label="Phone"><Input {...form.register("phone")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" error={e.email?.message}><Input type="email" {...form.register("email")} /></Field>
            <Field label="Payment terms (days)" error={e.paymentTermsDays?.message}><Input inputMode="numeric" {...form.register("paymentTermsDays")} /></Field>
          </div>
          <Field label="Address"><Input {...form.register("address")} /></Field>
          <Field label="Note"><Textarea rows={2} {...form.register("note")} /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
