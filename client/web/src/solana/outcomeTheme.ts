export type OutcomeTheme = {
  border: string;
  text: string;
  dot: string;
  bgSelected: string;
};

export function getOutcomeTheme(index: number): OutcomeTheme {
  switch (index) {
    case 0:
      return {
        border: "border-outcome-0",
        text: "text-outcome-0",
        dot: "bg-outcome-0",
        bgSelected: "bg-outcome-0-selected",
      };
    case 1:
      return {
        border: "border-outcome-1",
        text: "text-outcome-1",
        dot: "bg-outcome-1",
        bgSelected: "bg-outcome-1-selected",
      };
    case 2:
      return {
        border: "border-outcome-2",
        text: "text-outcome-2",
        dot: "bg-outcome-2",
        bgSelected: "bg-outcome-2-selected",
      };
    case 3:
      return {
        border: "border-outcome-3",
        text: "text-outcome-3",
        dot: "bg-outcome-3",
        bgSelected: "bg-outcome-3-selected",
      };
    default:
      return {
        border: "border-outcome-4",
        text: "text-outcome-4",
        dot: "bg-outcome-4",
        bgSelected: "bg-outcome-4-selected",
      };
  }
}
