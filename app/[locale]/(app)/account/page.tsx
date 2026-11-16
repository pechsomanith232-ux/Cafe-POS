import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { AccountForms } from "./account-forms";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "My account · Café POS" };

export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  return (
    <>
      <PageHeader title="My account" description={ctx.userName} />
      <AccountForms />
    </>
  );
}
