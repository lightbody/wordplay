import { cellAt, N, premium } from "../engine";
import type { PendingTile } from "../types";
import { Tile } from "./Tile";

interface BoardProps {
  board: string;
  pending: PendingTile[];
  lastMove?: Set<string>;
  onCellClick?: (row: number, col: number) => void;
  interactive?: boolean;
}

const PREMIUM_LABEL: Record<string, string> = {
  DL: "2×L",
  TL: "3×L",
  DW: "2×W",
  TW: "3×W",
};

export function Board({ board, pending, lastMove, onCellClick, interactive }: BoardProps) {
  const pendingAt = new Map(pending.map((t) => [`${t.row},${t.col}`, t]));

  const cells = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const key = `${row},${col}`;
      const committed = cellAt(board, row, col);
      const pend = pendingAt.get(key);
      const prem = premium(row, col);
      const isCenter = row === 7 && col === 7;
      const isLast = lastMove?.has(key);

      let content = null;
      if (pend) {
        content = (
          <Tile
            letter={pend.letter}
            blank={pend.blank}
            layoutId={`tile-${pend.rackIndex}`}
            pending
            small
          />
        );
      } else if (committed !== ".") {
        content = (
          <Tile
            letter={committed}
            blank={committed >= "a" && committed <= "z"}
            small
          />
        );
      }

      cells.push(
        <button
          key={key}
          type="button"
          className={[
            "cell",
            prem ? `cell-${prem.toLowerCase()}` : "",
            isCenter ? "cell-center" : "",
            isLast ? "cell-last" : "",
            content ? "cell-filled" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={interactive ? () => onCellClick?.(row, col) : undefined}
          disabled={!interactive}
        >
          {content ??
            (prem ? (
              <span className="cell-premium">{isCenter ? "★" : PREMIUM_LABEL[prem]}</span>
            ) : null)}
        </button>,
      );
    }
  }

  return <div className="board">{cells}</div>;
}
