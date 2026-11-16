"use client";

import { Check, Languages } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** One row per locale; picking one reloads the same page and query in that language. */
function LocaleItems() {
  const t = useTranslations("LanguageSwitcher");
  const current = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return routing.locales.map((next) => (
    <DropdownMenuItem
      key={next}
      lang={next}
      onSelect={() => router.replace({ pathname, query: Object.fromEntries(searchParams) }, { locale: next })}
    >
      <Check className={next === current ? undefined : "invisible"} /> {t(next)}
    </DropdownMenuItem>
  ));
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          <Languages /> <span className="sr-only">{t("label")}:</span> {t(locale)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <LocaleItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same choice as a submenu, for use inside another dropdown (the POS menu). */
export function LanguageSubMenu() {
  const t = useTranslations("LanguageSwitcher");
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Languages /> {t("label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <LocaleItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
