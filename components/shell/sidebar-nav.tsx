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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-2 pt-1 font-semibold">
        <Coffee className="size-5" /> Café POS
      </div>
      <BranchSwitcher branchId={data.branchId} branches={data.branches} />
      <nav className="flex-1 space-y-4 overflow-y-auto">
        {data.groups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
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
                    "flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent font-medium",
                  )}
                >
                  <Icon className="size-4" /> {item.label}
                  {item.badge === "lowStock" && <LowStockBadge branchId={data.branchId} />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t pt-3">
        <div className="px-2 text-sm font-medium">{data.userName}</div>
        <div className="px-2 pb-2 text-xs text-muted-foreground">{data.roleName}</div>
        <SignOutButton variant="ghost" />
      </div>
    </div>
  );
}

export function SidebarNav({ data, variant }: { data: SidebarData; variant: "desktop" | "mobile" }) {
  const [open, setOpen] = useState(false);
  if (variant === "desktop") return <NavContent data={data} />;
  return (
    <div className="flex items-center gap-2 border-b p-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <NavContent data={data} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <span className="font-semibold">Café POS</span>
    </div>
  );
}
