/**
 * How the answer's sources are named and grouped in the source card.
 *
 * The corpus stores `source` as "Wikipedia — https://en.wikipedia.org/wiki/X (CC BY-SA 4.0)":
 * name, URL and license in one string. The card shows the name as the overline and the URL
 * apart, in normal case (Prism S-2). Passages of the same article (same docId) are one row
 * with its passages inside (Iris: "Nosebleed", "Nosebleed", "Nosebleed" read as a bug).
 */
export interface SourceParts {
  name: string | null;
  url: string | null;
}

const URL_RE = /\bhttps?:\/\/[^\s)]+/i;

export function sourceParts(source: string | undefined): SourceParts {
  const s = source?.trim();
  if (!s) return { name: null, url: null };
  const [head, ...tail] = s.split(/\s+[—–]\s+/);
  if (tail.length > 0 && !URL_RE.test(head)) {
    // After the dash: the URL, which may hold spaces (pack URLs carry the raw title, Prism SR-1),
    // then an optional " (license)".
    const rest = tail.join(" — ").replace(/\s+\([^()]*\)\s*$/, "").trim();
    return { name: head.trim() || null, url: /^https?:\/\//i.test(rest) ? rest : rest.match(URL_RE)?.[0] ?? null };
  }
  const url = s.match(URL_RE)?.[0] ?? null;
  if (!url) return { name: s, url: null };
  try {
    return { name: new URL(url).hostname.replace(/^www\./, ""), url };
  } catch {
    return { name: null, url };
  }
}

type Chunk = { docId: string; title: string };

export interface SourceGroup {
  /** The article (docId); passages of one article share it. */
  key: string;
  title: string;
  /** Indexes into the answer's sources, in citation order ([n] = index + 1). */
  indexes: number[];
}

/** One group per article, in the order the article is first cited; `only` limits it to those indexes. */
export function groupSources(sources: Chunk[], only?: number[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  const byKey = new Map<string, SourceGroup>();
  const keep = only ? new Set(only) : null;
  sources.forEach((s, i) => {
    if (keep && !keep.has(i)) return;
    const key = s.docId || `#${i}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: s.title, indexes: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.indexes.push(i);
  });
  return groups;
}

/**
 * The relevance bar of each source, 0-100, straight from the engine's absolute relevance (0..1,
 * Tusk: RetrievedChunk.relevance). Never normalized by the best one (Prism CT-2: a weak best match
 * read as "100 %"). A source without a positive value gets no bar (null). Measured, never fixed.
 */
export function relevancePercents(sources: object[]): (number | null)[] {
  return sources.map((s) => {
    const v = (s as { relevance?: unknown }).relevance;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    return Math.min(100, Math.max(1, Math.round(v * 100)));
  });
}

/**
 * Which sources the answer actually rests on (Prism CT-2, Tusk done.cited): `cited` are the
 * indexes whose [n] stayed in the final text, plus the instant passage when it is shown; the
 * rest are only "related". null when the engine said nothing about it (older answers, a tier
 * still running): every source is shown as before.
 */
export function citedSplit(count: number, cited: number[] | undefined, instantIndex?: number): { cited: number[]; related: number[] } | null {
  if (!cited) return null;
  const set = new Set(cited.filter((n) => Number.isInteger(n) && n >= 1 && n <= count).map((n) => n - 1));
  if (instantIndex != null && instantIndex >= 0 && instantIndex < count) set.add(instantIndex);
  const all = Array.from({ length: count }, (_, i) => i);
  return { cited: all.filter((i) => set.has(i)), related: all.filter((i) => !set.has(i)) };
}

/** citedSplit for an answer: the instant passage counts as cited when it is shown. */
export function answerSourceSplit(a: {
  sources: unknown[];
  cited?: number[];
  instant?: { sourceIndex: number };
  weakSources?: boolean;
}): { cited: number[]; related: number[] } | null {
  return citedSplit(a.sources.length, a.cited, a.instant && !a.weakSources ? a.instant.sourceIndex : undefined);
}

/**
 * What the sources slot shows (Prism CT-2): while the answer is written and the engine hasn't said
 * which [n] stayed, only the count; then the cited sources, or only "Related" when none is cited.
 * "all" = an engine or a record without cited: every source, as before.
 */
export function sourcesCardMode(active: boolean, split: { cited: number[] } | null): "found" | "related" | "cited" | "all" {
  if (!split) return active ? "found" : "all";
  return split.cited.length === 0 ? "related" : "cited";
}
