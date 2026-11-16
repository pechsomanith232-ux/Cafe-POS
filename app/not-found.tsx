// Non-locale 404 (e.g. a path the proxy matcher skipped). No root <html> exists above it, so it renders its own.
export default function NotFound() {
  return (
    <html lang="en">
      <body>
        <h1>Page not found</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- outside any locale; next/link is banned in app/ by the i18n guard */}
        <a href="/">Go to start</a>
      </body>
    </html>
  );
}
