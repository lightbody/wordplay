import type { ReactNode } from "react";

const TONES = {
  default: { bg: "var(--ink-900)", color: "var(--paper-100)" },
  success: { bg: "var(--sage-600)", color: "var(--paper-50)" },
  error: { bg: "var(--red-600)", color: "var(--paper-50)" },
} as const;

export function Toast({
  children,
  tone = "default",
  icon,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  icon?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 18px",
        borderRadius: "var(--radius-lg)",
        background: t.bg,
        color: t.color,
        font: "var(--text-body-sm)",
        fontWeight: 600,
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {icon}
      {children}
    </div>
  );
}
