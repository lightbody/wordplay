import { avatarColorHex } from "@wordplay/shared";

// Legacy hash-derived look, kept only as a fallback for a name with no
// explicit emoji/color (e.g. a stale cached row mid-rollout).
const LEGACY_COLORS = ["#EF7A4C", "#8FB89B", "#7BAFCF", "#F0C25B", "#E293AC"];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({
  name,
  emoji,
  color,
  size = 40,
}: {
  name: string;
  emoji?: string | null;
  color?: string | null;
  size?: number;
}) {
  const bg = color ? avatarColorHex(color) : LEGACY_COLORS[hash(name) % LEGACY_COLORS.length];
  const content = emoji || name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "var(--radius-pill)",
        background: bg,
        color: "var(--text-on-accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "var(--text-button)",
        fontSize: size * (emoji ? 0.55 : 0.42),
      }}
    >
      {content}
    </div>
  );
}
