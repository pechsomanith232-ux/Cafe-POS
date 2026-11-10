import { SignOutButton } from "@/components/shared/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NoAccessPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No branch assigned</CardTitle>
          <CardDescription>
            Your account isn&apos;t assigned to any active branch yet. Ask a manager or the owner to
            give you a role at a branch, then sign in again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
