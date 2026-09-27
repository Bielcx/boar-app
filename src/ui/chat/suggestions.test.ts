import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coveredSuggestions, SUGGESTION_SOURCES, suggestionsFor } from "./suggestions";

const ALL = ["wiki-vital5", "boar-preparedness"];

describe("suggestionsFor", () => {
  it("offers only what each model passed in each language (with every corpus installed)", () => {
    expect(suggestionsFor("qwen3-4b-instruct-2507-q4km", "pt", ALL)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(suggestionsFor("qwen2.5-1.5b-instruct-q4km", "pt-BR", ALL)).toEqual(["q3"]);
    expect(suggestionsFor("qwen2.5-1.5b-instruct-q4km", "en", ALL)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("offers nothing for a model that wasn't validated", () => {
    expect(suggestionsFor("phi-3.5-mini-instruct-q4km", "en", ALL)).toEqual([]);
    expect(suggestionsFor(undefined, "en", ALL)).toEqual([]);
  });
});

describe("coveredSuggestions (RT-1)", () => {
  it("hides a question whose on-topic source isn't installed ('seasons' on the builtin base)", () => {
    expect(suggestionsFor("qwen3-4b-instruct-2507-q4km", "en")).toEqual(["q2"]);
    expect(suggestionsFor("qwen3-4b-instruct-2507-q4km", "en", ["boar-preparedness"])).toEqual(["q2", "q4"]);
  });

  it("keeps unknown keys out", () => {
    expect(coveredSuggestions(["q2", "zz"], [])).toEqual(["q2"]);
  });

  it("every builtin-covered suggestion has an on-topic title in the shipped builtin corpus", () => {
    const titles: string[] = JSON.parse(readFileSync(join(__dirname, "../../../assets/corpus/corpus.json"), "utf8")).map(
      (d: { title: string }) => d.title
    );
    for (const s of SUGGESTION_SOURCES.filter((x) => x.corpus.includes("builtin"))) {
      expect(s.expect.some((w) => titles.includes(w)), s.key).toBe(true);
    }
  });

  it("every suggestion has its text and topic in EN and PT", () => {
    for (const lang of ["en", "pt"]) {
      const chat = JSON.parse(readFileSync(join(__dirname, `../../i18n/locales/${lang}.json`), "utf8")).chat;
      for (const s of SUGGESTION_SOURCES) {
        expect(chat.suggestions[s.key], `${lang} ${s.key}`).toBeTruthy();
        expect(chat.suggestionTopics[s.key], `${lang} topic ${s.key}`).toBeTruthy();
      }
    }
  });
});
