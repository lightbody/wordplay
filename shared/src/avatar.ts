// Customizable user avatars: one emoji + one background color, both from
// small curated sets so every avatar reads as "part of the game."

export const AVATAR_EMOJI = [
  "🦊",
  "🐸",
  "🐙",
  "🦉",
  "🐢",
  "🦁",
  "🐯",
  "🐼",
  "🦄",
  "🐳",
  "🎲",
  "🎯",
  "🃏",
  "🧩",
  "🏆",
  "⭐",
  "🔥",
  "🚀",
  "📚",
  "🧠",
] as const;
export type AvatarEmoji = (typeof AVATAR_EMOJI)[number];

export interface AvatarColor {
  id: string;
  hex: string;
  name: string;
}

// The "deep" (-600) and "vivid" (-400/-500) tier from each of the app's 5
// hue families (coral/sage/sky/sun/berry). The vivid 5 match the hex values
// Avatar.tsx already hashed usernames onto, so existing avatars don't
// visually jump when this palette is introduced.
export const AVATAR_COLORS: readonly AvatarColor[] = [
  { id: "coral-deep", hex: "#E4602F", name: "Coral (deep)" },
  { id: "coral-vivid", hex: "#EF7A4C", name: "Coral" },
  { id: "sage-deep", hex: "#5C8C6B", name: "Sage (deep)" },
  { id: "sage-vivid", hex: "#8FB89B", name: "Sage" },
  { id: "sky-deep", hex: "#3E7CA6", name: "Sky (deep)" },
  { id: "sky-vivid", hex: "#7BAFCF", name: "Sky" },
  { id: "sun-deep", hex: "#DDA426", name: "Sun (deep)" },
  { id: "sun-vivid", hex: "#F0C25B", name: "Sun" },
  { id: "berry-deep", hex: "#C85C7E", name: "Berry (deep)" },
  { id: "berry-vivid", hex: "#E293AC", name: "Berry" },
] as const;
export type AvatarColorId = (typeof AVATAR_COLORS)[number]["id"];

const EMOJI_SET = new Set<string>(AVATAR_EMOJI);
const COLOR_IDS = new Set<string>(AVATAR_COLORS.map((c) => c.id));

export function isValidAvatarEmoji(v: string): v is AvatarEmoji {
  return EMOJI_SET.has(v);
}

export function isValidAvatarColorId(v: string): v is AvatarColorId {
  return COLOR_IDS.has(v);
}

export function avatarColorHex(id: string): string {
  return AVATAR_COLORS.find((c) => c.id === id)?.hex ?? AVATAR_COLORS[0].hex;
}

export function randomAvatar(): { emoji: AvatarEmoji; colorId: AvatarColorId } {
  const emoji = AVATAR_EMOJI[Math.floor(Math.random() * AVATAR_EMOJI.length)];
  const colorId = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)].id;
  return { emoji, colorId };
}
