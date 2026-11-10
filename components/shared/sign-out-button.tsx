"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      onClick={async () => {
        // The POS cart is per user: don't leave it for whoever signs in next on this tablet.
      try { sessionStorage.removeItem("pos-cart"); } catch { /* storage unavailable */ }
      await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut /> Sign out
    </Button>
  );
}
