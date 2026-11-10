import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { canManageMenu, canViewMenu } from "@/lib/menu-access";
import { listModifierGroups } from "@/lib/queries/menu";
import { ModifiersTable } from "./modifiers-table";

export const metadata = { title: "Modifier groups · Café POS" };

export default async function ModifiersPage({ searchParams }: PageProps<"/menu/modifiers">) {
  const ctx = await getContext();
  if (!canViewMenu(ctx)) return <AccessDenied permission="menu.view" />;
  const showInactive = (await searchParams).show === "all";
  const rows = await listModifierGroups(ctx, { includeInactive: showInactive });
  return (
    <>
      <PageHeader title="Modifier groups" description="Options added to a drink, like milk choice or extra shots, with their price and recipe change." />
      <ModifiersTable rows={rows} canEdit={canManageMenu(ctx)} showInactive={showInactive} />
    </>
  );
}
