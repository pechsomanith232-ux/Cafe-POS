"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Plus, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  assignRoleAction,
  createUserAction,
  removeRoleAction,
  resetPasswordAction,
  setUserActiveAction,
  setUserPinAction,
  testPinAction,
  updateUserNameAction,
} from "@/app/(app)/settings/actions";
import { Field } from "@/components/shared/field";
import { ManagerPinDialog } from "@/components/shared/manager-pin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UserRow } from "@/lib/queries/settings";
import { createUserInput } from "@/lib/validators/settings";

type Option = { id: string; name: string };
type BranchOption = { id: string; code: string; name: string };
const NO_ACCESS = "__none__";

export function UsersManager({
  users,
  roles,
  branches,
  activeBranchId,
  currentUserId,
}: {
  users: UserRow[];
  roles: Option[];
  branches: BranchOption[];
  activeBranchId: string;
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [testingPin, setTestingPin] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q)) : users;
  }, [users, query]);
  const managing = users.find((u) => u.userId === managingId) ?? null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTestingPin(true)}>
            <KeyRound /> Test a manager PIN
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New user
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Branch roles</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.userId} className="cursor-pointer" onClick={() => setManagingId(u.userId)}>
                <TableCell className="font-medium">
                  {u.name} {u.userId === currentUserId && <span className="text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.assignments.length === 0 && <span className="text-sm text-muted-foreground">No branch</span>}
                    {u.assignments.map((a) => (
                      <Badge key={a.branchId} variant="secondary">{a.branchCode}: {a.roleName}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{u.hasPin ? "Set" : "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? "secondary" : "outline"}>{u.isActive ? "Active" : "Deactivated"}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No users found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {creating && (
        <CreateUserDialog roles={roles} branches={branches} defaultBranchId={activeBranchId} onClose={() => setCreating(false)} />
      )}
      <Sheet open={!!managing} onOpenChange={(open) => !open && setManagingId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {managing && (
            <ManageUser key={managing.userId} user={managing} roles={roles} branches={branches} isSelf={managing.userId === currentUserId} />
          )}
        </SheetContent>
      </Sheet>
      <ManagerPinDialog
        open={testingPin}
        onOpenChange={setTestingPin}
        permission="pos.discount.override"
        title="Test a manager PIN"
        description="Checks that a manager's PIN works here. Nothing else happens."
        onConfirm={async (approval) => {
          const r = await testPinAction(approval, "pos.discount.override");
          if (r.ok) toast.success("PIN approved.");
          return r;
        }}
      />
    </>
  );
}

type CreateIn = z.input<typeof createUserInput>;
type CreateOut = z.output<typeof createUserInput>;

function CreateUserDialog({
  roles,
  branches,
  defaultBranchId,
  onClose,
}: {
  roles: Option[];
  branches: BranchOption[];
  defaultBranchId: string;
  onClose: () => void;
}) {
  const form = useForm<CreateIn, unknown, CreateOut>({
    resolver: zodResolver(createUserInput),
    defaultValues: { email: "", name: "", password: "", branchId: defaultBranchId, roleId: "", pin: undefined },
  });
  const e = form.formState.errors;

  async function onSubmit(values: CreateOut) {
    const r = await createUserAction(values);
    if (r.ok) {
      toast.success(`${values.name} can now sign in.`);
      onClose();
    } else toast.error(r.error);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
          <Field label="Full name" error={e.name?.message}><Input {...form.register("name")} /></Field>
          <Field label="Email (used to sign in)" error={e.email?.message}><Input type="email" {...form.register("email")} /></Field>
          <Field label="Temporary password" error={e.password?.message}>
            <Input type="text" autoComplete="off" {...form.register("password")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch" error={e.branchId?.message}>
              <Controller
                control={form.control}
                name="branchId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} · {b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Role" error={e.roleId ? "Pick a role" : undefined}>
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field label="Manager PIN (optional, 4–6 digits)" error={e.pin?.message}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              {...form.register("pin", { setValueAs: (v: string) => (v ? v : undefined) })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>Create user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageUser({
  user,
  roles,
  branches,
  isSelf,
}: {
  user: UserRow;
  roles: Option[];
  branches: BranchOption[];
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(user.name);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        after?.();
      } else toast.error(r.error ?? "Failed");
    });

  return (
    <div className="grid gap-5 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{user.name}</SheetTitle>
        <SheetDescription>{user.email}</SheetDescription>
      </SheetHeader>

      <div className="grid gap-2">
        <Field label="Full name">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="outline" disabled={pending || name === user.name} onClick={() => run(() => updateUserNameAction(user.userId, name), "Name saved.")}>
              Save
            </Button>
          </div>
        </Field>
      </div>

      <Separator />
      <div className="grid gap-3">
        <h3 className="text-sm font-medium">Role at each branch</h3>
        {branches.map((b) => {
          const current = user.assignments.find((a) => a.branchId === b.id);
          return (
            <div key={b.id} className="flex items-center justify-between gap-3">
              <span className="text-sm">{b.code} · {b.name}</span>
              <Select
                value={current?.roleId ?? NO_ACCESS}
                disabled={pending || isSelf}
                onValueChange={(roleId) =>
                  run(
                    () =>
                      roleId === NO_ACCESS
                        ? removeRoleAction({ userId: user.userId, branchId: b.id })
                        : assignRoleAction({ userId: user.userId, branchId: b.id, roleId }),
                    "Role updated.",
                  )
                }
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCESS}>No access</SelectItem>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {isSelf && <p className="text-xs text-muted-foreground">You can&apos;t change your own roles.</p>}
      </div>

      <Separator />
      <Field label="Reset password (signs them out everywhere)">
        <div className="flex gap-2">
          <Input type="text" autoComplete="off" placeholder="New password, 8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="outline" disabled={pending || password.length < 8} onClick={() => run(() => resetPasswordAction(user.userId, password), "Password reset.", () => setPassword(""))}>
            Reset
          </Button>
        </div>
      </Field>
      <Field label={`Manager PIN ${user.hasPin ? "(set)" : "(not set)"}`}>
        <div className="flex gap-2">
          <Input inputMode="numeric" type="password" autoComplete="off" maxLength={6} placeholder="4–6 digits" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <Button variant="outline" disabled={pending || pin.length < 4} onClick={() => run(() => setUserPinAction(user.userId, pin), "PIN saved.", () => setPin(""))}>
            Set PIN
          </Button>
        </div>
      </Field>

      <Separator />
      <label className="flex items-center justify-between text-sm">
        <span>
          Account active
          <span className="block text-xs text-muted-foreground">Deactivated users can&apos;t sign in.</span>
        </span>
        <Switch
          checked={user.isActive}
          disabled={pending || isSelf}
          onCheckedChange={(on) => run(() => setUserActiveAction(user.userId, on), on ? "User activated." : "User deactivated.")}
        />
      </label>
    </div>
  );
}
