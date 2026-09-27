import { describe, expect, it } from "vitest";
import { formatBytes, formatBytesParts, formatRam, formatSeconds, minutesLeft } from "./format";

describe("formatBytes", () => {
  it("uses the locale's decimal separator", () => {
    expect(formatBytes(1_250_000_000, "en")).toBe("1.3 GB");
    expect(formatBytes(1_250_000_000, "pt")).toBe("1,3 GB");
  });

  it("uses decimal units, like the system file picker and Settings (Prism N-14)", () => {
    // boar-crypto.sqlite: 35,962,880 bytes, shown as 35.96 MB by Android.
    expect(formatBytes(35_962_880, "en")).toBe("36 MB");
    expect(formatBytes(19_554_304, "en")).toBe("19.6 MB");
  });

  it("picks the unit by size", () => {
    expect(formatBytes(986_000_000, "en")).toBe("986 MB");
    // Never four digits of the smaller unit (iOS shot: "1,000 MB on disk").
    expect(formatBytes(999_600_000, "en")).toBe("1 GB");
    expect(formatBytes(999_000_000, "en")).toBe("999 MB");
    expect(formatBytes(999_700, "en")).toBe("1 MB");
    expect(formatBytesParts(1_250_000_000, "pt")).toEqual({ value: "1,3", unit: "GB" });
    expect(formatBytes(2_500_000, "en")).toBe("2.5 MB");
    expect(formatBytes(600_000, "en")).toBe("600 KB");
  });
});

describe("formatRam", () => {
  it("uses binary units, as phones are sold: 16 GiB reads 16 GB", () => {
    expect(formatRam(16 * 1024 ** 3, "en")).toBe("16 GB");
    expect(formatRam(3.8 * 1024 ** 3, "pt")).toBe("3,8 GB");
    expect(formatRam(512 * 1024 ** 2, "en")).toBe("512 MB");
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
