import { useState } from "react";
import { AVATAR_COLORS, AVATAR_EMOJI, avatarColorHex } from "@wordplay/shared";
import { Dialog } from "./Dialog";

export function AvatarEditorDialog({
  initialEmoji,
  initialColor,
  saving,
  onSave,
  onCancel,
}: {
  initialEmoji: string;
  initialColor: string;
  saving: boolean;
  onSave: (emoji: string, color: string) => void;
  onCancel: () => void;
}) {
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor);

  return (
    <Dialog
      onClose={onCancel}
      title="Edit avatar"
      actions={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(emoji, color)}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="avatar-preview" style={{ background: avatarColorHex(color) }}>
        {emoji}
      </div>

      <div className="avatar-emoji-grid">
        {AVATAR_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className={e === emoji ? "active" : ""}
            aria-pressed={e === emoji}
            onClick={() => setEmoji(e)}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="avatar-color-row">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={c.id === color ? "active" : ""}
            aria-label={c.name}
            aria-pressed={c.id === color}
            style={{ background: c.hex }}
            onClick={() => setColor(c.id)}
          />
        ))}
      </div>
    </Dialog>
  );
}
