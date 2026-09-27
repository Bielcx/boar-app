/** Locale-aware numbers for the flow screens ("1,2 GB" in PT, "1.2 GB" in EN). */

// Files and storage in decimal units, as Android and iOS show them (Prism N-14): the
// same file must read the same size here, in the system file picker and in Settings.
const KB = 1000;
const MB = 1000 * KB;
const GB = 1000 * MB;
// Memory (RAM) in binary units, as phones advertise it: a "16 GB" phone has 16 GiB.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function formatBytes(bytes: number, locale: string): string {
  const { value, unit } = formatBytesParts(bytes, locale);
  return `${value} ${unit}`;
}

/** Number and unit apart, for a big figure with a small unit (`Stat`). */
export function formatBytesParts(bytes: number, locale: string): { value: string; unit: string } {
  // Switch units where the smaller one would round to four digits ("1,000 MB" reads as 1.0 GB).
  if (bytes >= 999.5 * MB) return { value: number(bytes / GB, locale, 1), unit: "GB" };
  if (bytes >= 999.5 * KB) return { value: number(bytes / MB, locale, bytes >= 100 * MB ? 0 : 1), unit: "MB" };
  return { value: number(Math.max(bytes, 0) / KB, locale, 0), unit: "KB" };
}

/** Memory sizes (device RAM, working set), in the binary units phones are sold with. */
export function formatRam(bytes: number, locale: string): string {
  if (bytes >= 999.5 * MIB) return `${number(bytes / GIB, locale, 1)} GB`;
  return `${number(Math.max(bytes, 0) / MIB, locale, 0)} MB`;
}

export function formatCount(n: number, locale: string): string {
  return number(n, locale, 0);
}

export function formatSeconds(ms: number, locale: string): string {
  return `${number(ms / 1000, locale, ms < 10_000 ? 1 : 0)} s`;
}

export function formatRate(tokPerSec: number, locale: string): string {
  return number(tokPerSec, locale, 1);
}

/** Minutes, rounded up, for time-left estimates; at least 1. */
export function minutesLeft(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
