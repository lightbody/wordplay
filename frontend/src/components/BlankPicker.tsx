import { Dialog } from "./Dialog";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function BlankPicker({
  onChoose,
  onCancel,
}: {
  onChoose: (letter: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      onClose={onCancel}
      title="Choose a letter for the blank"
      actions={
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      <div className="letter-grid">
        {LETTERS.map((l) => (
          <button key={l} className="btn letter-btn" onClick={() => onChoose(l)}>
            {l}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
