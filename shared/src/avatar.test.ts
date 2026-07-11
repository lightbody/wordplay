import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS,
  AVATAR_EMOJI,
  avatarColorHex,
  isValidAvatarColorId,
  isValidAvatarEmoji,
  randomAvatar,
} from "./avatar.js";

describe("AVATAR_EMOJI", () => {
  it("has between 15 and 30 entries, all unique", () => {
    expect(AVATAR_EMOJI.length).toBeGreaterThanOrEqual(15);
    expect(AVATAR_EMOJI.length).toBeLessThanOrEqual(30);
    expect(new Set(AVATAR_EMOJI).size).toBe(AVATAR_EMOJI.length);
  });
});

describe("AVATAR_COLORS", () => {
  it("has exactly 10 entries with unique ids and hex values", () => {
    expect(AVATAR_COLORS.length).toBe(10);
    expect(new Set(AVATAR_COLORS.map((c) => c.id)).size).toBe(10);
    expect(new Set(AVATAR_COLORS.map((c) => c.hex)).size).toBe(10);
  });
});

describe("isValidAvatarEmoji", () => {
  it("accepts members of AVATAR_EMOJI and rejects everything else", () => {
    expect(isValidAvatarEmoji(AVATAR_EMOJI[0])).toBe(true);
    expect(isValidAvatarEmoji("😀")).toBe(false);
    expect(isValidAvatarEmoji("")).toBe(false);
  });
});

describe("isValidAvatarColorId", () => {
  it("accepts members of AVATAR_COLORS and rejects everything else", () => {
    expect(isValidAvatarColorId(AVATAR_COLORS[0].id)).toBe(true);
    expect(isValidAvatarColorId("not-a-color")).toBe(false);
    expect(isValidAvatarColorId("")).toBe(false);
  });
});

describe("avatarColorHex", () => {
  it("resolves known ids to their hex value", () => {
    for (const c of AVATAR_COLORS) {
      expect(avatarColorHex(c.id)).toBe(c.hex);
    }
  });

  it("falls back to the first color for unknown ids", () => {
    expect(avatarColorHex("bogus")).toBe(AVATAR_COLORS[0].hex);
  });
});

describe("randomAvatar", () => {
  it("always returns members of the sets", () => {
    for (let i = 0; i < 50; i++) {
      const { emoji, colorId } = randomAvatar();
      expect(isValidAvatarEmoji(emoji)).toBe(true);
      expect(isValidAvatarColorId(colorId)).toBe(true);
    }
  });
});
