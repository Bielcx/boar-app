import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

/**
 * Nothing on screen says "token" (Prism UX-1, r4to's copy rule): speeds and counts are in words
 * ("~8 words/s"). Technical log keys that must keep the word go in TECHNICAL: the Evaluation
 * screen's share preview, a developer tool whose numbers are compared with other phones in tokens/s
 * (docs/RESULTS_SCORE.md).
 */
const TECHNICAL = new Set<string>(["evaluation.preview.tokPerSec", "evaluation.preview.ttft", "evaluation.preview.formula"]);
const JARGON = /\btokens?\b|\btok\/s\b/i;

function jargon(tree: unknown, path = ""): string[] {
  if (typeof tree === "string") return JARGON.test(tree) && !TECHNICAL.has(path) ? [`${path} = ${tree}`] : [];
  if (tree && typeof tree === "object") {
    return Object.entries(tree).flatMap(([k, v]) => jargon(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("no 'token' in the app's copy", () => {
  it.each([
    ["en", en],
    ["pt", pt],
  ])("%s.json", (_lang, strings) => {
    expect(jargon(strings)).toEqual([]);
  });

  it("the check catches it", () => {
    expect(jargon({ a: { b: "{{rate}} tokens/s" }, c: "16 tok/s", d: "Tokenizer-free words" })).toEqual([
      "a.b = {{rate}} tokens/s",
      "c = 16 tok/s",
    ]);
  });
});
