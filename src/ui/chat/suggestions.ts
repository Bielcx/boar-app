/**
 * Which suggested questions (chat.suggestions.q1..) the empty state offers,
 * per model and UI language: only those the model answered correctly and
 * safely in that language, 3 of 3 seeds, outside the test sets.
 *
 * Re-validate with Sextant when a model or a question changes, then bump
 * `version` and `validatedAt`. A model not listed gets no suggestions.
 */
export const SUGGESTION_VALIDATION = {
  version: 1,
  validatedAt: "2026-09-26",
  evidence: "eval/results/suggestions/verdicts.v1.json (feat/eval-frontier)",
  byModel: {
    "qwen3-4b-instruct-2507-q4km": { en: ["q1", "q2", "q3", "q4"], pt: ["q1", "q2", "q3", "q4"] },
    "qwen2.5-1.5b-instruct-q4km": { en: ["q1", "q2", "q3", "q4"], pt: ["q3"] },
  } as Record<string, Record<"en" | "pt", string[]>>,
};

/**
 * Where each suggestion's answer comes from (Boar/Prism RT-1: "Why do we have
 * seasons on Earth?" retrieved Walipini and Hot weather). A suggestion shows
 * only when one of its `corpus` ids is installed ("builtin" = the 300-topic
 * base shipped in the app, always there), and `expect` lists title words of an
 * on-topic source. Sextant's test: asking the question with only that corpus
 * must return a source whose title contains one of them.
 *
 * Checked by title against the shipped corpora (26/09): the builtin has
 * "Pandemic", "Photosynthesis", "Vaccine", "Immune system", "Greenhouse
 * effect"; neither builtin nor corpus-standard/full has "Season" or
 * "Fahrenheit" (standard is a random Wikipedia sample). wiki-vital5 entries
 * are UNVERIFIED until Bramble/Sextant confirm. New keys (q5-q7) show once a
 * model's list in SUGGESTION_VALIDATION includes them.
 */
export interface SuggestionSource {
  key: string;
  corpus: string[];
  expect: string[];
}

export const SUGGESTION_SOURCES: SuggestionSource[] = [
  { key: "q1", corpus: ["wiki-vital5"], expect: ["Season", "Axial tilt"] },
  { key: "q2", corpus: ["builtin"], expect: ["Pandemic", "Epidemic"] },
  { key: "q3", corpus: ["wiki-vital5"], expect: ["Fahrenheit", "Celsius"] },
  { key: "q4", corpus: ["boar-preparedness"], expect: ["Nosebleed", "Epistaxis"] },
  { key: "q5", corpus: ["builtin"], expect: ["Photosynthesis"] },
  { key: "q6", corpus: ["builtin"], expect: ["Vaccine", "Immune system"] },
  { key: "q7", corpus: ["builtin"], expect: ["Greenhouse effect", "Climate change"] },
];

/** Keys whose on-topic source is installed. `installed` holds knowledge ids; "builtin" is implied. */
export function coveredSuggestions(keys: string[], installed: Iterable<string>): string[] {
  const have = new Set<string>(["builtin", ...installed]);
  const byKey = new Map(SUGGESTION_SOURCES.map((s) => [s.key, s]));
  return keys.filter((k) => byKey.get(k)?.corpus.some((c) => have.has(c)) ?? false);
}

/** What the empty chat offers: validated for the model and language, and covered by the installed knowledge. */
export function suggestionsFor(modelId: string | undefined, language: string | undefined, installed: Iterable<string> = []): string[] {
  if (!modelId) return [];
  const byLang = SUGGESTION_VALIDATION.byModel[modelId];
  if (!byLang) return [];
  return coveredSuggestions(byLang[language?.startsWith("pt") ? "pt" : "en"] ?? [], installed);
}
