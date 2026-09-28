import { readFileSync } from "node:fs";
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
});
