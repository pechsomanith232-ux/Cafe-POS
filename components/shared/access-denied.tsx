import { ShieldAlert } from "lucide-react";

/** Shown when someone opens a page their role doesn't allow (the server always re-checks). */
export function AccessDenied({ permission }: { permission?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your role at this branch doesn&apos;t allow it{permission ? ` (needs ${permission})` : ""}. Ask
        the owner if you think this is a mistake.
      </p>
    </div>
  );
}
