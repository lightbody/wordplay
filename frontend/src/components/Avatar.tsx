const COLORS = ["#EF7A4C", "#8FB89B", "#7BAFCF", "#F0C25B", "#E293AC"];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const bg = COLORS[hash(name) % COLORS.length];
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
        fontSize: size * 0.42,
      }}
    >
      {initial}
    </div>
  );
}
