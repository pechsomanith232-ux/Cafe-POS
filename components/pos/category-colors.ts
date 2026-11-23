/**
 * POS category palette (the one place raw colors are allowed): six clear,
 * distinct hues that read well with white text. Categories get a color by
 * their position in the menu, so the chips and product accent bars always
 * match and stay consistent from branch to branch.
 */
export const CATEGORY_COLORS = [
  "#9a5b2e", // coffee
  "#2f7d5b", // tea green
  "#c2410c", // orange
  "#1d6fa5", // blue
  "#9d3f78", // berry
  "#7a6a1f", // olive
] as const;

export function categoryColorMap(categoryIds: string[]): Record<string, string> {
  return Object.fromEntries(categoryIds.map((id, i) => [id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
}
