/**
 * Portuguese questions against English sources: the English article names a Portuguese question mentions,
 * from a lexicon built out of Wikipedia's own interlanguage links and Portuguese redirects
 * (scripts/build-pt-lexicon.mjs; "estações do ano" -> Season, "efeito estufa" -> Greenhouse effect).
 * Pure: the lexicon is passed in, so it can be tested without the asset.
 */

export type Lexicon = Record<string, string>;

/** Lower case, no accents, no trailing "(disambiguation)", single spaces: the lexicon's key form. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PT_MARKERS =
  /\b(o|os|que|como|porque|por que|qual|quais|uma|um|sao|nao|e|das|dos|nas|nos|numa|num|pelo|pela|onde|quando|quanto|quantos|existem|fazer|faco|devo|entre|diferenca|depois|antes|em|para|com|se|posso|pode|tem|funciona)\b/;

/**
 * Whether a question reads as Portuguese: two function words English doesn't use, or one plus an accent or a
 * short question. An accent alone isn't enough: English questions name "Medellín" or "São Paulo".
 */
export function looksPortuguese(query: string): boolean {
  const words = normalizeKey(query).match(/[a-z0-9]+/g) ?? [];
  const hits = words.filter((w) => PT_MARKERS.test(w)).length;
  // Accents count in lower-case words only: "São Paulo" is a name, "estações" is Portuguese.
  const accented = /(^|[^\p{L}])[a-zà-ÿ]*[ãõçâêôáéíóú][\p{L}]*/u.test(query);
  return hits >= 2 || (hits >= 1 && (accented || words.length <= 4));
}

// Words that never start or end a name, and never are one on their own.
const STOP = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas num numa por para com sem que como qual quais quando onde porque se ao aos e ou é nao mais menos muito entre sobre ate apos depois antes existem existe fazer faco devo pode posso quanto quantos quanta quantas isso isto esse essa este esta the of and".split(
    " "
  )
);

/** Singular forms of a Portuguese word (estações -> estação, monções -> monção, vacinas -> vacina, animais -> animal). */
export function singularsPt(word: string): string[] {
  const out: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/oes$/, "ao"],
    [/aes$/, "ao"],
    [/ais$/, "al"],
    [/eis$/, "el"],
    [/ois$/, "ol"],
    [/is$/, "il"],
    [/ns$/, "m"],
    [/res$/, "r"],
    [/zes$/, "z"],
    [/s$/, ""],
  ];
  for (const [re, to] of rules) if (re.test(word) && word.length > 3) out.push(word.replace(re, to));
  return out;
}

/** Keys to try for a run of words: as written, then with the last word (the head in "estações do ano": the first) singular. */
function variants(words: string[]): string[] {
  const out = [words.join(" ")];
  for (let i = 0; i < words.length; i++) {
    for (const s of singularsPt(words[i])) out.push([...words.slice(0, i), s, ...words.slice(i + 1)].join(" "));
  }
  return out;
}

// Lower-cased English titles of a lexicon, for words written the same in both languages ("Fahrenheit", "Ethereum").
const titleSets = new WeakMap<Lexicon, Map<string, string>>();
function englishTitles(lexicon: Lexicon): Map<string, string> {
  let m = titleSets.get(lexicon);
  if (!m) {
    m = new Map(Object.values(lexicon).map((t) => [normalizeKey(t), t]));
    titleSets.set(lexicon, m);
  }
  return m;
}

/**
 * English article names mentioned by a Portuguese question, longest names first, words used once
 * ("Qual a diferença entre fusão e fissão nuclear?" -> Nuclear fission, then Nuclear fusion if "fusão" alone maps).
 */
export function englishNamesIn(query: string, lexicon: Lexicon, max = 4, maxLen = 5): string[] {
  const words = normalizeKey(query).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  const used = new Array(words.length).fill(false);
  const names: string[] = [];
  for (let len = Math.min(maxLen, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      if (names.length >= max) return names;
      const gram = words.slice(i, i + len);
      if (used.slice(i, i + len).some(Boolean)) continue;
      if (STOP.has(gram[0]) || STOP.has(gram[len - 1])) continue;
      if (len === 1 && gram[0].length < 4) continue;
      const hit =
        variants(gram).map((k) => lexicon[k]).find(Boolean) ??
        // A single word spelled the same as an English title ("Fahrenheit"): the lexicon keeps one-word Portuguese
        // names from exact titles only, so a cognate that was only a redirect is found this way.
        (len === 1 ? englishTitles(lexicon).get(gram[0]) : undefined);
      if (!hit) continue;
      for (let j = i; j < i + len; j++) used[j] = true;
      if (!names.includes(hit)) names.push(hit);
    }
  }
  return names;
}
