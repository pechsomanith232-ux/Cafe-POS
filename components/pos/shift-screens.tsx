"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { openShiftAction } from "@/app/pos/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Currency = { code: string; symbol: string };

export function RegisterPicker({ registers, registerId }: { registers: { id: string; name: string }[]; registerId: string }) {
  const router = useRouter();
  if (registers.length < 2) return null;
  return (
    <Select value={registerId} onValueChange={(id) => router.push(`/pos?register=${id}`)}>
      <SelectTrigger className="h-8 w-40" aria-label="Register"><SelectValue /></SelectTrigger>
      <SelectContent>{registers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Shown on /pos when the register has no open shift (plan §4.8: no selling without one). */
export function OpenShiftScreen({
  branchId, branchName, registerId, registerName, registers, userName, currencies, canOpen,
}: {
  branchId: string; branchName: string; registerId: string; registerName: string; registers: { id: string; name: string }[]; userName: string; currencies: Currency[]; canOpen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [floats, setFloats] = useState<Record<string, string>>(Object.fromEntries(currencies.map((c) => [c.code, ""])));
  const open = () =>
    start(async () => {
      const r = await openShiftAction({ branchId, registerId, floats: currencies.map((c) => ({ currencyCode: c.code, amount: floats[c.code]?.trim() || "0" })) });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Shift opened.");
      router.refresh();
    });
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Open a shift — {registerName}</CardTitle>
          <CardDescription>{branchName} · {userName}. Count the cash in the drawer before you start selling.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <RegisterPicker registers={registers} registerId={registerId} />
          {canOpen ? (
            <>
              {currencies.map((c) => (
                <Field key={c.code} label={`Opening float (${c.code})`}>
                  <Input aria-label={`Opening float ${c.code}`} inputMode="decimal" placeholder="0" value={floats[c.code]} onChange={(e) => setFloats({ ...floats, [c.code]: e.target.value })} />
                </Field>
              ))}
              <Button size="lg" onClick={open} disabled={pending}>{pending ? "Opening…" : "Open shift"}</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">There&apos;s no open shift on this register, and your role can&apos;t open one. Ask a manager.</p>
          )}
          <Button variant="ghost" onClick={() => router.push("/dashboard")}>Back office</Button>
        </CardContent>
      </Card>
    </div>
  );
}
