const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function BlankPicker({
  onChoose,
  onCancel,
}: {
  onChoose: (letter: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a letter for the blank</h3>
        <div className="letter-grid">
          {LETTERS.map((l) => (
            <button key={l} className="btn letter-btn" onClick={() => onChoose(l)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
