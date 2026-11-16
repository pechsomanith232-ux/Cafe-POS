import { Suspense } from "react";
import { LoginForm } from "./login-form";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Sign in · Café POS" };

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
