/**
 * CT-1 (Prism): a [n] must point at a source that supports its sentence. The
 * models answer from memory and still cite [1] ("Earth's axial tilt causes
 * the seasons [1]" with [1] = Walipini, a greenhouse). A citation stays only
 * when the source contains at least half of the sentence's key words; one
 * pointing past the sources is always dropped. Pure.
 */
import type { RetrievedChunk } from "../rag/retrieve.types";
import { tokenizeTerms } from "./context";

/** Share of a cited sentence's key words the source must contain. */
export const CITATION_MIN_SUPPORT = 0.5;
/** Sentences with fewer key words than this are too short to judge: the citation stays. */
const MIN_KEY_TERMS = 2;

const same = (a: string, b: string) => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short) && long.length - short.length <= 3;
};

/** The sentence a citation at `at` belongs to: back past "." and spaces right before it, then to the previous sentence end. */
function sentenceBefore(text: string, at: number): string {
  let j = at;
  while (j > 0 && /[\s\]\d[]/.test(text[j - 1]) && !/[.!?\n]/.test(text[j - 1])) j--;
  if (j > 0 && /[.!?]/.test(text[j - 1])) j--;
  let start = j;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  return text.slice(start, j);
}

export function citationSupport(sentence: string, source: RetrievedChunk): number {
  const key = [...new Set(tokenizeTerms(sentence.replace(/\[\d+\]/g, " ")))];
  if (key.length < MIN_KEY_TERMS) return 1;
  const have = tokenizeTerms(`${source.title} ${source.body}`);
  return key.filter((k) => have.some((h) => same(h, k))).length / key.length;
}

export interface CheckedCitations {
  text: string;
  /** Source numbers removed, in order of appearance. */
  removed: number[];
}

export function checkCitations(answer: string, sources: RetrievedChunk[]): CheckedCitations {
  const removed: number[] = [];
  const text = answer.replace(/\s?\[(\d+)\]/g, (whole, num: string, at: number) => {
    const n = Number(num);
    const source = sources[n - 1];
    const keep = !!source && citationSupport(sentenceBefore(answer, at + whole.indexOf("[")), source) >= CITATION_MIN_SUPPORT;
    if (keep) return whole;
    removed.push(n);
    return "";
  });
  return { text: removed.length ? text.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ") : answer, removed };
}
