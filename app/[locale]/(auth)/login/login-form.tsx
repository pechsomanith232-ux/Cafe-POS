"use client";

import { Coffee, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/safe-redirect";


export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(
        error.code === "FAILED_TO_CREATE_SESSION"
          ? "This account is deactivated. Ask a manager."
          : error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401
            ? "Wrong email or password."
            : "Couldn't sign in. Please try again.",
      );
      return;
    }
    router.replace(safeRedirectPath(params.get("next"), window.location.origin));
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Coffee className="size-6" />
        </div>
        <CardTitle className="text-xl">Café POS</CardTitle>
        <CardDescription>Sign in with the account your manager gave you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" disabled={pending} className="h-11">
            {pending && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
