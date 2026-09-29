import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("chat perf guards (LAYOUT-AUDIT)", () => {
  it("#31: the places minute clock runs only where local time shows; rows are memoized with the place bound", () => {
    const src = read("PlacesCard.tsx");
    expect(src).toMatch(/useMinuteClock\(deviceClockApplies\(r\.area\)\)/);
    expect(src).toMatch(/const PlaceRow = memo\(/);
    expect(src).toMatch(/onOpen=\{setOpenPlace\}/);
  });

  it("#36: initModels is stable (no [t, locale] deps) and never runs twice at once", () => {
    const src = read("../ChatScreen.tsx");
    const init = src.match(/const initModels = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[(.*?)\]\);/);
    expect(init).not.toBeNull();
    expect(init![1]).toBe("");
    expect(init![0]).toMatch(/if \(initInFlight\.current\) return;/);
    expect(init![0]).toMatch(/finally \{\s*initInFlight\.current = false;/);
  });

  it("GFXINFO: the step ring is the chat's only looping animation, and it stops once the text streams", () => {
    const files = [...readdirSync(__dirname).filter((f) => f.endsWith(".tsx")), "../ChatScreen.tsx", "../ChatHeader.tsx"];
    const loops = files.filter((f) => /Animated\.loop|withRepeat/.test(read(f)));
    expect(loops).toEqual(["AssistantMessage.tsx"]);
    const am = read("AssistantMessage.tsx");
    expect(am.match(/Animated\.loop/g)).toHaveLength(1);
    expect(am).toMatch(/const turning = !reduceMotion && !still;/);
    expect(am).toMatch(/<StepSpinner still=\{still\} \/>/);
    expect(am.match(/<StepsCard steps=\{steps\} still=\{ringStill\} \/>/g)).toHaveLength(2);
    expect(am).toMatch(/const ringStill = !stepSpinnerRuns\(answer\);/);
  });
});
