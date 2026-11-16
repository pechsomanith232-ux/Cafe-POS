// The <html> shell lives in app/[locale]/layout.tsx; this root only exists so app/not-found.tsx can render.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return children;
}
