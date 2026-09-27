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

/** One group per article, in the order the article is first cited. */
export function groupSources(sources: Chunk[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  const byKey = new Map<string, SourceGroup>();
  sources.forEach((s, i) => {
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
 * The relevance bar of each source, 0-100 within this answer (the most relevant = 100), from the
 * engine's comparable relevance (asked of Tusk: RetrievedChunk.relevance, 0..1). A source without
 * it gets no bar (null), and so does every source when none has a positive value. Never a fixed
 * number: the percentage is measured, as the r4to/Boar decision requires.
 */
export function relevancePercents(sources: object[]): (number | null)[] {
  const vals = sources.map((s) => {
    const v = (s as { relevance?: unknown }).relevance;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  });
  const max = Math.max(0, ...vals.map((v) => v ?? 0));
  return vals.map((v) => (v == null || max <= 0 ? null : Math.max(1, Math.round((v / max) * 100))));
}
