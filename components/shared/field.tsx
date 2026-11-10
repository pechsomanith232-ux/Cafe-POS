/**
 * Label + control + error message, for forms. The control sits inside the
 * <label>, so the label names it for screen readers and tapping it focuses it.
 */
export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-2 text-sm leading-none font-medium select-none">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
