import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const chat = ["AssistantMessage.tsx", "PlacesCard.tsx", "ChatPieces.tsx", "../ChatScreen.tsx"].map(read).join("\n");

describe("chat visual minors (Prism CH-22..CH-28)", () => {
  it("CH-28: no literal sizes next to tokens", () => {
    expect(chat).not.toMatch(/bottom: 96\b/);
    expect(chat).not.toMatch(/borderLeftWidth: 2\b/);
    expect(chat).not.toMatch(/size\.touch \+ 8\b/);
    expect(chat).not.toMatch(/fontScale >= \d/);
  });
  it("CH-22/CH-23/CH-24: ember and solid amber only where they mean something", () => {
    const am = read("AssistantMessage.tsx");
    expect(am).not.toMatch(/<Text variant="label" color="accent" header>\s*\{tr\("chat\.deep\.title"\)\}/);
    expect(am).not.toMatch(/tone="field" emphasis="solid"/);
    expect(am).not.toMatch(/band === "low" \? "secondary" : "field"/);
  });
  it("CH-28/CH-29: the composer uses the opacity tokens and the DS Stop", () => {
    const composer = read("Composer.tsx");
    expect(composer).not.toMatch(/opacity: [^,}]*\b0\.\d/);
    expect(composer).toMatch(/variant="stop"/);
    expect(composer).not.toMatch(/<Pressable\b/);
  });
  it("Stop gives one haptic, the IconButton's (not a second one from stopActive)", () => {
    const stop = read("../ChatScreen.tsx").match(/const stopActive = useCallback\([\s\S]*?\n  \}, \[\]\);/)![0];
    expect(stop).not.toMatch(/impact\(/);
  });
  it("CH-27: the finished receipt sits at the row's end, as the running pill", () => {
    // The pill and the receipt share one Swap at the row's end (SEND-MOTION crossfade).
    const src = read("AssistantMessage.tsx");
    expect(src).toMatch(/<Swap swapKey=\{pill\} style=\{\{ marginLeft: "auto", flexShrink: 1 \}\}>/);
    expect(src).toMatch(/pill === "elapsed" \? \([\s\S]*?<Elapsed[\s\S]*?<ReceiptToggle r=\{receipt\} hidden=\{active\} \/>/);
  });
});
