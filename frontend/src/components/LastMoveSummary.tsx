import type { LastMoveSummary as LastMoveSummaryData } from "../lastMove";

export function LastMoveSummary({ summary }: { summary: LastMoveSummaryData | undefined }) {
  if (!summary) return null;
  return (
    <p className="last-move-summary">
      <strong>{summary.mine ? "You" : "They"}</strong> played <strong>{summary.word}</strong> for{" "}
      <strong>{summary.points} points</strong>.
    </p>
  );
}
