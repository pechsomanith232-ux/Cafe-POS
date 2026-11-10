"use client";

// Last resort: an error in the root layout itself. Renders its own document (no app styles).
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <div role="alert">
          <title>Something went wrong · Café POS</title>
          <h1 style={{ fontSize: 18 }}>Something went wrong</h1>
          <p>Nothing was lost. Please try again.</p>
          <button onClick={() => retry()} style={{ padding: "8px 16px", fontSize: 14 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
