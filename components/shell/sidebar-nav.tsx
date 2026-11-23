"use client";

import {
  BarChart3,
  Repeat,
  ArrowLeftRight,
  CalendarClock,
  FileText,
  ShoppingBasket,
  Truck,
  Wallet,
  Boxes,
  Building2,
  ClipboardCheck,
  ChefHat,
  Coffee,
  Contact,
  LayoutGrid,
  MonitorSmartphone,
  SlidersHorizontal,
  ListPlus,
  History,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavGroup, NavIcon } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { LowStockBadge } from "@/components/inventory/low-stock-badge";
import { BranchSwitcher } from "./branch-switcher";

export type SidebarData = {
  userName: string;
  roleName: string;
  branchId: string;
  branches: { id: string; code: string; name: string }[];
  groups: NavGroup[];
};

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  branches: Building2,
  users: Users,
  roles: ShieldCheck,
  audit: History,
  account: UserCircle,
  items: Boxes,
  movements: ArrowLeftRight,
  adjustments: SlidersHorizontal,
  counts: ClipboardCheck,
  suppliers: Truck,
  receipts: FileText,
  quickPurchase: ShoppingBasket,
  payments: Wallet,
  aging: CalendarClock,
  products: Coffee,
  modifiers: ListPlus,
  menuCategories: LayoutGrid,
  pos: MonitorSmartphone,
  kitchen: ChefHat,
  posSettings: SlidersHorizontal,
  customers: Contact,
  reports: BarChart3,
  transfers: Repeat,
};

function NavContent({ data, onNavigate }: { data: SidebarData; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-2 pt-1 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
          <Coffee className="size-4" />
        </span>
        Café POS
      </div>
      <BranchSwitcher branchId={data.branchId} branches={data.branches} />
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {data.groups.map((group) => (
          <div key={group.key}>
            <div className="px-2 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(`groups.${group.key}`)}</div>
            <div className="grid gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const path = item.href.split("?")[0];
              const active = item.href.includes("?") ? false : pathname === path || (pathname.startsWith(path + "/") && !pathname.endsWith("/new"));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                    active && "bg-primary/10 font-medium text-primary hover:bg-primary/15",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} /> {t(`items.${item.key}`)}
                  {item.badge === "lowStock" && <LowStockBadge branchId={data.branchId} />}
                </Link>
              );
            })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t pt-3">
        <div className="px-2 text-sm font-medium">{data.userName}</div>
        <div className="px-2 pb-2 text-xs text-muted-foreground">{data.roleName}</div>
        <div className="flex flex-wrap items-center gap-1">
          <SignOutButton variant="ghost" />
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}

export function SidebarNav({ data, variant }: { data: SidebarData; variant: "desktop" | "mobile" }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("Nav");
  if (variant === "desktop") return <NavContent data={data} />;
  return (
    <div className="flex items-center gap-2 border-b bg-sidebar p-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("openMenu")}>
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
          <NavContent data={data} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <span className="font-semibold">Café POS</span>
    </div>
  );
}
