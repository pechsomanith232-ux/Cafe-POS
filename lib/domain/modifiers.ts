// Modifier group selection rules (plan §5.3: min_select / max_select).

export type SelectionRule = { name: string; minSelect: number; maxSelect: number };

const options = (n: number) => `${n} option${n === 1 ? "" : "s"}`;

/** null when `count` options satisfy the group, otherwise a message for the cashier. */
export function checkModifierSelection(group: SelectionRule, count: number): string | null {
  const { name, minSelect: min, maxSelect: max } = group;
  if (count >= min && count <= max) return null;
  if (min === max) return `Choose ${options(min)} for ${name}.`;
  if (min === 0) return `Choose at most ${options(max)} for ${name}.`;
  return `Choose ${min} to ${max} options for ${name}.`;
}
