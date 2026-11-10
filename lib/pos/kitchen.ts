/** Kitchen ticket colour by time since sent (plan §6): green < 5 min, amber < 10, red ≥ 10. */
export function elapsedTone(ms: number): "green" | "amber" | "red" {
  return ms < 5 * 60_000 ? "green" : ms < 10 * 60_000 ? "amber" : "red";
}
