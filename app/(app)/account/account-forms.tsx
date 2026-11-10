"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setMyPin } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function AccountForms() {
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirm"))) {
      toast.error("The new passwords don't match.");
      return;
    }
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) toast.error(error.message ?? "Couldn't change the password.");
    else {
      toast.success("Password changed. Other devices were signed out.");
      formEl.reset();
    }
  }

  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" name="newPassword" type="password" minLength={8} autoComplete="new-password" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Repeat new password</Label>
              <Input id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required />
            </div>
            <Button type="submit">Change password</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Manager PIN</CardTitle>
          <CardDescription>4–6 digits. Used to approve voids, refunds and large discounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await setMyPin(pin);
                if (r.ok) {
                  toast.success("PIN saved.");
                  setPin("");
                } else toast.error(r.error);
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="pin">New PIN</Label>
              <Input
                id="pin"
                inputMode="numeric"
                type="password"
                autoComplete="off"
                pattern="\d{4,6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <Button type="submit" disabled={pending}>Save PIN</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
