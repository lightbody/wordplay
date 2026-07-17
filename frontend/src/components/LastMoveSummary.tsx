import { useEffect, useState } from "react";
import type { LastMoveSummary as LastMoveSummaryData } from "../lastMove";
import { pickBestWord } from "../lastMove";
import type { PlayRating, TopMoveDto } from "../types";

const CHIP_LABELS: Record<PlayRating, string> = {
  wow: "Wow!",
  great: "Great",
  good: "Good",
  meh: "Meh",
};

/**
 * The one-line "You played WORD for N points." caption under the scorebar,
 * plus the move's rating chip. `topMoves` (the best plays that were
 * available) is only ever passed for the mover's own just-submitted move —
 * it comes from the play response, not sync, because the alternatives
 * reveal rack letters — and makes the chip expandable into the best-plays
 * panel. Without it the chip is inert, which is what the opponent (and a
 * reloaded session) sees.
 */
export function LastMoveSummary({
  summary,
  topMoves,
}: {
  summary: LastMoveSummaryData | undefined;
  topMoves?: TopMoveDto[];
}) {
  const [open, setOpen] = useState(false);
  const moveId = summary?.moveId;
  useEffect(() => setOpen(false), [moveId]);

  if (!summary) return null;
  const expandable = summary.rating !== null && topMoves !== undefined && topMoves.length > 0;
  return (
    <p className="last-move-summary">
      <strong>{summary.mine ? "You" : "They"}</strong> played <strong>{summary.word}</strong> for{" "}
      <strong>{summary.points} points</strong>.
      {summary.rating !== null &&
        (expandable ? (
          <button
            className={`rating-chip rating-chip-${summary.rating}`}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {CHIP_LABELS[summary.rating]}
          </button>
        ) : (
          <span className={`rating-chip rating-chip-${summary.rating}`}>{CHIP_LABELS[summary.rating]}</span>
        ))}
      {expandable && open && (
        <span className="best-plays-panel">
          <span className="best-plays-title">Best available plays</span>
          {topMoves.map((m, i) => (
            <span key={i} className="best-plays-row">
              <span className="best-plays-word">{pickBestWord(m.words)?.word ?? "—"}</span>
              <span className="best-plays-score">{m.score}</span>
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
