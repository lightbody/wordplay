import { Dialog } from "./Dialog";
import { Tile } from "./Tile";
import { unseenTiles } from "../unseenTiles";

/** "Unseen tiles": every tile not on the board and not in this player's own
 * rack, grouped by letter with a remaining count -- could be in the bag or
 * in the opponent's rack, and there's no way (or need) to tell which. */
export function UnseenTiles({
  board,
  rack,
  onClose,
}: {
  board: string;
  rack: string;
  onClose: () => void;
}) {
  const counts = unseenTiles(board, rack);

  return (
    <Dialog
      onClose={onClose}
      title="Unseen tiles"
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="muted">Not on the board or in your rack -- could be in the bag or your opponent's rack.</p>
      <div className="unseen-tiles-grid">
        {counts.map(({ letter, count }) => (
          <div key={letter} className="unseen-tile-cell" style={{ opacity: count === 0 ? 0.35 : 1 }}>
            <Tile letter={letter === "?" ? "" : letter} blank={letter === "?"} board />
            <span className="unseen-tile-count">{count}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
