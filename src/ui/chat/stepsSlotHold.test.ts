import { describe, expect, it } from "vitest";
import { slotHold } from "./stepsSlotHold";

describe("slotHold (SEND-MOTION v2 P3)", () => {
  it("while the steps card shows, the card sizes the slot", () => {
    expect(slotHold(true, 110, false)).toBeUndefined();
  });
  it("when the text takes the card's place, the slot keeps the card's height (no cut, no jump)", () => {
    expect(slotHold(false, 110, false)).toBe(110);
  });
  it("once the answer is over, the hold goes (a short answer ends at its own height)", () => {
    expect(slotHold(false, 110, true)).toBeUndefined();
  });
  it("a restored answer never had a card: no hold", () => {
    expect(slotHold(false, 0, false)).toBeUndefined();
  });
});
