import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { useTheme, type ThemePreference } from "../theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AccountMenu({
  username,
  email,
  onSignOut,
}: {
  username: string;
  email?: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { preference, setPreference } = useTheme();
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
        <Avatar name={username} size={36} />
      </button>

      {open && (
        <div className="account-menu-panel" role="menu">
          <div className="account-menu-header">
            <Avatar name={username} size={36} />
            <div className="account-menu-identity">
              <div className="account-menu-username">@{username}</div>
              {email && <div className="account-menu-email">{email}</div>}
            </div>
          </div>

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
    </div>
  );
}
