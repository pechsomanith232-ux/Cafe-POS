import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { PERMISSIONS, PERMISSIONS_WITH_LIMIT } from "@/lib/permissions-catalog";
import { listRoles } from "@/lib/queries/settings";
import { RolesManager } from "./roles-manager";

export const metadata = { title: "Roles · Café POS" };

export default async function RolesPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "roles.manage")) return <AccessDenied permission="roles.manage" />;
  const roles = await listRoles(ctx);
  const catalog = Object.entries(PERMISSIONS).map(([key, description]) => ({
    key,
    description,
    hasLimit: (PERMISSIONS_WITH_LIMIT as readonly string[]).includes(key),
  }));
  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role may do. A user's role is set per branch on the Users page." />
      <RolesManager roles={roles} catalog={catalog} />
    </>
  );
}
