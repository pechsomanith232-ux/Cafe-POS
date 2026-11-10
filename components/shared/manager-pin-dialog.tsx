"use client";

import { Delete, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { listApproversAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import type { PermissionKey } from "@/lib/permissions-catalog";

export type PinApproval = { approverId: string; pin: string };

/**
 * Manager PIN dialog (plan §6). The approver picks their name and types their
 * PIN on a touch keypad. The dialog never decides anything itself: it hands
 * `{ approverId, pin }` to `onConfirm`, which calls the sensitive Server
 * Action — and that action verifies the PIN on the server.
 */
export function ManagerPinDialog({
  open,
  onOpenChange,
  permission,
  title = "Manager approval",
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permission: PermissionKey;
  title?: string;
  description?: string;
  onConfirm: (approval: PinApproval) => Promise<ActionResult<unknown>>;
}) {
  const [approvers, setApprovers] = useState<{ userId: string; name: string }[] | null>(null);
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listApproversAction(permission).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setApprovers(r.data);
        if (r.data.length === 1) setApproverId(r.data[0].userId);
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
      setPin("");
      setError(null);
    };
  }, [open, permission]);

  async function submit() {
    if (!approverId || pin.length < 4) return;
    setBusy(true);
    setError(null);
    const r = await onConfirm({ approverId, pin });
    setBusy(false);
    if (r.ok) onOpenChange(false);
    else {
      setError(r.error);
      setPin("");
    }
  }

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {approvers === null ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>
        ) : approvers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody at this branch can approve this yet. A manager needs to set a PIN under My account.
          </p>
        ) : (
          <div className="grid gap-3">
            <Select value={approverId} onValueChange={setApproverId}>
              <SelectTrigger className="w-full" aria-label="Approver">
                <SelectValue placeholder="Who is approving?" />
              </SelectTrigger>
              <SelectContent>
                {approvers.map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              aria-label="PIN"
              className="h-12 rounded-md border text-center text-2xl tracking-[0.5em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Button key={d} type="button" variant="outline" className="h-12 text-lg" onClick={() => press(d)}>{d}</Button>
              ))}
              <Button type="button" variant="ghost" className="h-12" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}>
                <Delete />
              </Button>
              <Button type="button" variant="outline" className="h-12 text-lg" onClick={() => press("0")}>0</Button>
              <Button type="button" className="h-12" disabled={busy || !approverId || pin.length < 4} onClick={submit}>
                {busy ? <Loader2 className="animate-spin" /> : "OK"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
