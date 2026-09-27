import type { Lexicon } from "./ptLexicon";

let cached: Lexicon | null = null;

/** The bundled Portuguese -> English name lexicon (assets/lexicon/pt-en.json), loaded on first use. */
export function ptLexicon(): Lexicon {
  if (!cached) {
    try {
      cached = require("../../assets/lexicon/pt-en.json") as Lexicon;
    } catch {
      cached = {};
    }
  }
  return cached;
}
