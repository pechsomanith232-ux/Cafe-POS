import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { listRoles, listUsers } from "@/lib/queries/settings";
import { UsersManager } from "./users-manager";

export const metadata = { title: "Users · Café POS" };

export default async function UsersPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "users.manage")) return <AccessDenied permission="users.manage" />;
  const [users, roles] = await Promise.all([listUsers(ctx), listRoles(ctx)]);
  const branches = [...ctx.access.values()]
    .filter((b) => b.permissions.has("users.manage"))
    .map((b) => ({ id: b.branchId, code: b.branchCode, name: b.branchName }));
  return (
    <>
      <PageHeader title="Users" description="Staff accounts, their role at each branch, and PINs." />
      <UsersManager
        users={users}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        branches={branches}
        activeBranchId={ctx.branchId}
        currentUserId={ctx.userId}
      />
    </>
  );
}
