import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { AccountForms } from "./account-forms";

export const metadata = { title: "My account · Café POS" };

export default async function AccountPage() {
  const ctx = await getContext();
  return (
    <>
      <PageHeader title="My account" description={ctx.userName} />
      <AccountForms />
    </>
  );
}
