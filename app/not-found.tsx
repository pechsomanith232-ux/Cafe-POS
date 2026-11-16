// Non-locale 404 (e.g. a path the proxy matcher skipped). No root <html> exists above it, so it renders its own.
export default function NotFound() {
  return (
    <html lang="en">
      <body>
        <h1>Page not found</h1>
        <a href="/">Go to start</a>
      </body>
    </html>
  );
}
