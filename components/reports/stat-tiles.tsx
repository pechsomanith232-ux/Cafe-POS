/** Stat tiles (dataviz contract): sentence-case label, semibold value, optional note. Text uses text tokens only. */
export function StatTiles({ tiles }: { tiles: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{t.value}</dd>
          {t.note && <dd className="text-xs text-muted-foreground">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
