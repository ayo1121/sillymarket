// Colors used for outcomes in UI (cards + charts).
// 0: green, 1: red, 2: blue, 3: yellow, 4: purple
export const OUTCOME_COLORS: string[] = [
  "#16a34a", // green
  "#dc2626", // red
  "#2563eb", // blue
  "#eab308", // yellow
  "#a855f7", // purple
];

/**
 * Safely resolve the color for a given outcome index.
 * Falls back to black if index is null/invalid.
 */
export function getOutcomeColor(index: number | null | undefined): string {
  if (index == null || index < 0 || index >= OUTCOME_COLORS.length) {
    return "#000000";
  }
  return OUTCOME_COLORS[index];
}

export function getOutcomeColorStyles(index: number | null | undefined, isSelected = false): {
  borderColor: string;
  backgroundColor: string | undefined;
  color: string;
} {
  const color = getOutcomeColor(index);
  return {
    borderColor: color,
    backgroundColor: isSelected ? `${color}20` : undefined,
    color,
  };
}
