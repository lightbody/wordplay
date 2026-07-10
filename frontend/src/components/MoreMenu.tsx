import { Dialog } from "./Dialog";

export function MoreMenu({
  passDisabled,
  resignDisabled,
  onPass,
  onResign,
  onUnseenTiles,
  onClose,
}: {
  passDisabled: boolean;
  resignDisabled: boolean;
  onPass: () => void;
  onResign: () => void;
  onUnseenTiles: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      onClose={onClose}
      title="More actions"
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="modal-action-list">
        <button className="btn btn-block" onClick={onUnseenTiles}>
          Unseen tiles
        </button>
        <button className="btn btn-block" disabled={passDisabled} onClick={onPass}>
          Pass
        </button>
        <button className="btn btn-danger btn-block" disabled={resignDisabled} onClick={onResign}>
          Resign
        </button>
      </div>
    </Dialog>
  );
}
