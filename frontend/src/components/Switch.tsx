export function Switch({
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 26,
        borderRadius: "var(--radius-pill)",
        border: "none",
        padding: 3,
        background: checked ? "var(--accent-secondary)" : "var(--border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--duration-standard) var(--ease-standard)",
        display: "inline-flex",
        justifyContent: checked ? "flex-end" : "flex-start",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--radius-pill)",
          background: "var(--paper-0)",
          boxShadow: "var(--shadow-xs)",
          transition: "transform var(--duration-standard) var(--ease-bounce)",
          display: "block",
        }}
      />
    </button>
  );
}
