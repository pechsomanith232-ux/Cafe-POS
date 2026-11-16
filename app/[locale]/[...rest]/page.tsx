import { notFound } from "next/navigation";

// Unknown paths under a locale render app/[locale]/not-found.tsx inside the locale layout.
export default function CatchAllPage() {
  notFound();
}
