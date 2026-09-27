import { describe, expect, it } from "vitest";
import { formatBytes, formatSeconds, minutesLeft } from "./format";

describe("formatBytes", () => {
  it("uses the locale's decimal separator", () => {
    expect(formatBytes(1.25 * 1024 ** 3, "en")).toBe("1.3 GB");
    expect(formatBytes(1.25 * 1024 ** 3, "pt")).toBe("1,3 GB");
  });

  it("picks the unit by size", () => {
    expect(formatBytes(986 * 1024 ** 2, "en")).toBe("986 MB");
    expect(formatBytes(2.5 * 1024 ** 2, "en")).toBe("2.5 MB");
    expect(formatBytes(600 * 1024, "en")).toBe("600 KB");
  });
});

describe("formatSeconds", () => {
  it("keeps a decimal under ten seconds", () => {
    expect(formatSeconds(1800, "pt")).toBe("1,8 s");
    expect(formatSeconds(12_400, "en")).toBe("12 s");
  });
});

describe("minutesLeft", () => {
  it("rounds up and never says zero", () => {
    expect(minutesLeft(10)).toBe(1);
    expect(minutesLeft(61)).toBe(2);
  });
});
