import { describe, it, expect } from "vitest";
import { headerFit, TITLE_MIN } from "./headerLayout";

// Same numbers ChatHeader passes: 2 buttons (menu, new chat), padding 8×2 + gaps 4×2 + 8×2, avatar 32 + 8.
const base = { buttons: 2, chrome: 40, avatar: 40 };
const OFFLINE = "OFFLINE".length;
const ANSWERS_OFFLINE = "ANSWERS OFFLINE".length;
const ios = (width: number, fontScale: number, sealChars = OFFLINE) => headerFit({ ...base, width, fontScale, touch: 44, sealChars });
const android = (width: number, fontScale: number, sealChars = OFFLINE) => headerFit({ ...base, width, fontScale, touch: 48, sealChars });

describe("headerFit", () => {
  it("shows the short OFFLINE seal with text at the mockup's 393pt (tone button gone)", () => {
    expect(ios(393, 1)).toEqual({ seal: "text", avatar: true });
    expect(ios(402, 1)).toEqual({ seal: "text", avatar: true });
    expect(android(412, 1)).toEqual({ seal: "text", avatar: true });
  });

  it("drops the seal text before the title on 360dp and with large text", () => {
    expect(android(360, 1)).toEqual({ seal: "icon", avatar: true });
    expect(ios(393, 1.3)).toEqual({ seal: "icon", avatar: true });
    expect(ios(375, 1.3)).toEqual({ seal: "icon", avatar: true });
    expect(android(360, 1.3)).toEqual({ seal: "icon", avatar: false });
  });

  it("keeps the long downloader seal ('Answers offline') icon-only on phones (iOS shot 4f0819f)", () => {
    expect(ios(402, 1, ANSWERS_OFFLINE)).toEqual({ seal: "icon", avatar: true });
    expect(ios(768, 1, ANSWERS_OFFLINE)).toEqual({ seal: "text", avatar: true });
  });

  it("always leaves the title at least its minimum when it keeps the avatar", () => {
    for (const width of [320, 360, 375, 393, 402, 430]) {
      for (const fontScale of [1, 1.3, 2]) {
        const fit = ios(width, fontScale);
        const seal = fit.seal === "text" ? OFFLINE * 8 + 42 : 44;
        const left = width - base.chrome - base.buttons * 44 - seal - (fit.avatar ? base.avatar : 0);
        if (fit.avatar) expect(left).toBeGreaterThanOrEqual(TITLE_MIN * fontScale);
      }
    }
  });
});

describe("the downloader seal 'ON DEVICE' / 'NO APARELHO' (Boar)", () => {
  it("fits with the avatar at 393 pt in both languages (chat header: 1 disc of 42, gutter 16, gaps 10)", () => {
    const chat = { buttons: 1, chrome: 16 * 2 + 10 * 2, avatar: 42 + 10, touch: 42, fontScale: 1, width: 393 };
    expect(headerFit({ ...chat, sealChars: "ON DEVICE".length })).toEqual({ seal: "text", avatar: true });
    expect(headerFit({ ...chat, sealChars: "NO APARELHO".length })).toEqual({ seal: "text", avatar: true });
    expect(headerFit({ ...chat, sealChars: "OFFLINE".length })).toEqual({ seal: "text", avatar: true });
  });
});
