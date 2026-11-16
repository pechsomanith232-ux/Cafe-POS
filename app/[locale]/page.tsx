import { redirect } from "next/navigation";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  redirect("/dashboard");
}
