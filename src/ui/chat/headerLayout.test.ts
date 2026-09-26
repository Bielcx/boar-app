import { describe, it, expect } from "vitest";
import { headerFit, TITLE_MIN } from "./headerLayout";

// Same numbers ChatHeader passes: padding 8×2 + gaps 4×4 + 8×2, avatar 32 + 8.
const base = { chrome: 48, avatar: 40 };
const ios = (width: number, fontScale: number, sealChars = "ANSWERS OFFLINE".length) =>
  headerFit({ ...base, width, fontScale, touch: 44, sealChars });
const android = (width: number, fontScale: number, sealChars = "ANSWERS OFFLINE".length) =>
  headerFit({ ...base, width, fontScale, touch: 48, sealChars });

describe("headerFit", () => {
  it("drops the seal text on phones instead of squeezing the name (iOS shot 4f0819f, 402pt)", () => {
    expect(ios(402, 1)).toEqual({ seal: "icon", avatar: true });
    expect(ios(402, 1, "OFFLINE".length)).toEqual({ seal: "icon", avatar: true });
  });

  it("keeps name and model readable at 375pt with large text by letting the avatar go", () => {
    expect(ios(375, 1)).toEqual({ seal: "icon", avatar: true });
    expect(ios(375, 1.3)).toEqual({ seal: "icon", avatar: false });
    expect(android(360, 1.3)).toEqual({ seal: "icon", avatar: false });
  });

  it("shows the seal text when there is room (tablets, landscape)", () => {
    expect(ios(768, 1)).toEqual({ seal: "text", avatar: true });
    expect(android(600, 1, "OFFLINE".length)).toEqual({ seal: "text", avatar: true });
  });

  it("always leaves the title at least its minimum in the widths it keeps the avatar", () => {
    for (const width of [320, 360, 375, 393, 402, 430]) {
      for (const fontScale of [1, 1.3, 2]) {
        const fit = ios(width, fontScale);
        const left = width - base.chrome - 3 * 44 - 44 - (fit.avatar ? base.avatar : 0);
        if (fit.avatar) expect(left).toBeGreaterThanOrEqual(TITLE_MIN * fontScale);
      }
    }
  });
});
