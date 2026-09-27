/** Locale-aware numbers for the flow screens ("1,2 GB" in PT, "1.2 GB" in EN). */

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function formatBytes(bytes: number, locale: string): string {
  if (bytes >= GB) return `${number(bytes / GB, locale, 1)} GB`;
  if (bytes >= MB) return `${number(bytes / MB, locale, bytes >= 100 * MB ? 0 : 1)} MB`;
  return `${number(Math.max(bytes, 0) / 1024, locale, 0)} KB`;
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
