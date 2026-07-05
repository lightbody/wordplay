export function MoreMenu({
  passDisabled,
  resignDisabled,
  onPass,
  onResign,
  onClose,
}: {
  passDisabled: boolean;
  resignDisabled: boolean;
  onPass: () => void;
  onResign: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>More actions</h3>
        <div className="modal-action-list">
          <button className="btn btn-block" disabled={passDisabled} onClick={onPass}>
            Pass
          </button>
          <button className="btn btn-danger btn-block" disabled={resignDisabled} onClick={onResign}>
            Resign
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
