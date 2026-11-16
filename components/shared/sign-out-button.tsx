"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const router = useRouter();
  const t = useTranslations("Nav");
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
      <LogOut /> {t("signOut")}
    </Button>
  );
}
