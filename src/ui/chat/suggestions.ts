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

export function suggestionsFor(modelId: string | undefined, language: string | undefined): string[] {
  if (!modelId) return [];
  const byLang = SUGGESTION_VALIDATION.byModel[modelId];
  if (!byLang) return [];
  return byLang[language?.startsWith("pt") ? "pt" : "en"] ?? [];
}
