import { describe, expect, it } from "vitest";
import { adjustment, evaluate, winner } from "./endgame.js";

describe("evaluate", () => {
  it("starts a two-move countdown when the bag empties", () => {
    const out = evaluate(true, null, 0, true, false);
    expect(out.finalMovesRemaining).toBe(2);
    expect(out.finished).toBe(null);
  });

  it("counts the countdown down to zero and ends the game", () => {
    let out = evaluate(true, 2, 0, true, false);
    expect(out.finalMovesRemaining).toBe(1);
    expect(out.finished).toBe(null);

    out = evaluate(true, 1, 0, true, false);
    expect(out.finalMovesRemaining).toBe(0);
    expect(out.finished).toBe("bag_final_moves");
  });

  it("ends immediately when the next player has an empty rack", () => {
    const out = evaluate(true, 2, 0, true, true);
    expect(out.finished).toBe("played_out");
  });

  it("ends the game after six scoreless turns", () => {
    const out = evaluate(false, null, 5, false, false);
    expect(out.scorelessStreak).toBe(6);
    expect(out.finished).toBe("scoreless_limit");
  });

  it("resets the streak on a scoring play", () => {
    const out = evaluate(false, null, 5, true, false);
    expect(out.scorelessStreak).toBe(0);
    expect(out.finished).toBe(null);
  });

  it("does not start the countdown while the bag has tiles", () => {
    const out = evaluate(false, null, 0, true, false);
    expect(out.finalMovesRemaining).toBe(null);
    expect(out.finished).toBe(null);
  });
});

describe("adjustment", () => {
  it("respects the deduct-unused option", () => {
    expect(adjustment(true, "QZ")).toBe(-20);
    expect(adjustment(false, "QZ")).toBe(0);
    expect(adjustment(true, "")).toBe(0);
  });
});

describe("winner", () => {
  it("picks by adjusted total, or draws on a tie", () => {
    expect(winner("a", "b", 100, 90)).toBe("a");
    expect(winner("a", "b", 90, 100)).toBe("b");
    expect(winner("a", "b", 100, 100)).toBe(null);
  });
});
