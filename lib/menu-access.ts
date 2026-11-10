import { hasPermission, type AppContext } from "./permissions";

/** Pages: may see the menu (menu.view or menu.manage) / may change it (menu.manage). */
export const canViewMenu = (ctx: AppContext) => hasPermission(ctx, ctx.branchId, "menu.view") || hasPermission(ctx, ctx.branchId, "menu.manage");
export const canManageMenu = (ctx: AppContext) => hasPermission(ctx, ctx.branchId, "menu.manage");
