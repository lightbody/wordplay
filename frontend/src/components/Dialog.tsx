import type { ReactNode } from "react";

export function Dialog({
  onClose,
  title,
  children,
  actions,
}: {
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43, 36, 32, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-8)",
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
        }}
      >
        {title && (
          <div
            style={{
              font: "var(--text-heading-lg)",
              fontFamily: "var(--font-display)",
              fontWeight: 400,
              marginBottom: "var(--space-3)",
            }}
          >
            {title}
          </div>
        )}
        {children}
        {actions && (
          <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center", marginTop: "var(--space-6)" }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
