import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { AvatarEditorDialog } from "./AvatarEditorDialog";
import { useTheme, type ThemePreference } from "../theme";
import { useSound } from "../sound";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SOUND_OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

export function AccountMenu({
  username,
  email,
  avatarEmoji,
  avatarColor,
  onAvatarSave,
  onFriends,
  onSignOut,
}: {
  username: string;
  email?: string;
  avatarEmoji: string;
  avatarColor: string;
  onAvatarSave: (emoji: string, color: string) => Promise<void>;
  onFriends?: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const { preference, setPreference } = useTheme();
  const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useSound();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={username} emoji={avatarEmoji} color={avatarColor} size={36} />
      </button>

      {open && (
        <div className="account-menu-panel" role="menu">
          <div className="account-menu-header">
            <Avatar name={username} emoji={avatarEmoji} color={avatarColor} size={36} />
            <div className="account-menu-identity">
              <div className="account-menu-username">@{username}</div>
              {email && <div className="account-menu-email">{email}</div>}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-block"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setEditingAvatar(true);
            }}
          >
            Edit avatar
          </button>

          {onFriends && (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onFriends();
              }}
            >
              Friends
            </button>
          )}

          <div className="account-menu-divider" />

          <div className="account-menu-label">Appearance</div>
          <div className="theme-segment" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={preference === opt.value}
                className={preference === opt.value ? "active" : ""}
                onClick={() => setPreference(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="account-menu-label">Sound</div>
          <div className="theme-segment" role="radiogroup" aria-label="Sound">
            {SOUND_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                role="radio"
                aria-checked={soundEnabled === opt.value}
                className={soundEnabled === opt.value ? "active" : ""}
                onClick={() => setSoundEnabled(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="account-menu-divider" />

          <button
            type="button"
            className="btn btn-ghost btn-block account-menu-signout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {editingAvatar && (
        <AvatarEditorDialog
          initialEmoji={avatarEmoji}
          initialColor={avatarColor}
          saving={savingAvatar}
          onCancel={() => setEditingAvatar(false)}
          onSave={async (emoji, color) => {
            setSavingAvatar(true);
            try {
              await onAvatarSave(emoji, color);
              setEditingAvatar(false);
            } finally {
              setSavingAvatar(false);
            }
          }}
        />
      )}
    </div>
  );
}
