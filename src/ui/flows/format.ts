/** Locale-aware numbers for the flow screens ("1,2 GB" in PT, "1.2 GB" in EN). */

// Files and storage: the app-wide formatter (src/models/units.ts, Ledger), decimal
// like Android and iOS show them (Prism N-14), with the locale's separators.
export { formatBytes, formatBytesParts } from "../../models/units";

// Memory (RAM) in binary units, as phones advertise it: a "16 GB" phone has 16 GiB.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
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

/** Minutes, to the nearest, for an up-front estimate ("~3 min" vs "~4 min"); at least 1. */
export function minutesAbout(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
