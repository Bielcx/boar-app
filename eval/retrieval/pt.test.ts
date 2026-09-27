/// <reference types="node" />
/**
 * Portuguese vs English retrieval on the same gold (PT-1): each Portuguese question (Sextant's *-pt sets, field
 * `from` = the English question's id) is searched three ways over several format-2 packs, the way the app
 * searches them (one pack after the other, articles the question names first):
 *   en      the English question
 *   pt      the Portuguese question as typed
 *   pt+lex  the Portuguese question plus a second search with the English names it mentions (src/rag/ptLexicon.ts),
 *           those results first — what retrieve() does
 * Recall@1/@3 on questions whose gold is a Wikipedia/Wikivoyage title. Skipped unless the env points at the files:
 *
 *   BOAR_PT_PACKS=a.sqlite,b.sqlite BOAR_PT_QUESTIONS=questions.v2-pt.jsonl,questions.safety-pt.jsonl \
 *   BOAR_PT_EN=questions.v2.jsonl,questions.safety.jsonl BOAR_PT_LEXICON=pt-en.json [BOAR_PT_OUT=out.json] \
 *     npx vitest run eval/retrieval/pt.test.ts
 */
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "../../src/rag/testing/nodeSqlite";
import { WikiPack, type PackHit } from "../../src/rag/wikiPack";
import { englishNamesIn, looksPortuguese, type Lexicon } from "../../src/rag/ptLexicon";

const env = process.env;
const list = (v?: string) => (v ?? "").split(",").filter(Boolean);
type Q = { id: string; from?: string; query: string; gold: Array<{ source: string; title?: string }> };
const read = (files: string[]): Q[] => files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));

describe.skipIf(!env.BOAR_PT_PACKS)("Portuguese vs English retrieval", () => {
  it("measures recall per mode", async () => {
    const packs = await Promise.all(list(env.BOAR_PT_PACKS).map((p) => WikiPack.open(nodeSqliteDatabase(p), decompress)));
    const lexicon: Lexicon = JSON.parse(readFileSync(env.BOAR_PT_LEXICON!, "utf8"));
    const en = new Map(read(list(env.BOAR_PT_EN)).map((q) => [q.id, q]));
    const pt = read(list(env.BOAR_PT_QUESTIONS)).filter((q) => q.gold.some((g) => g.title) && en.has(q.from ?? ""));

    const search = async (query: string, titles: string[] = []) => {
      const named: PackHit[] = [];
      const rest: PackHit[] = [];
      for (const p of packs) for (const h of await p.search(query, { k: 6, titles })) (h.via === "title" ? named : rest).push(h);
      return [...named, ...rest];
    };
    const ranked = async (mode: string, q: Q) => {
      if (mode === "en") return search(en.get(q.from!)!.query);
      const main = await search(q.query);
      if (mode === "pt") return main;
      const names = looksPortuguese(q.query) ? englishNamesIn(q.query, lexicon) : [];
      if (!names.length) return main;
      const extra = await search(names.join(" "), names);
      return [...extra.slice(0, 4), ...main, ...extra];
    };
    const out: Record<string, unknown> = { questions: pt.length, modes: {} as Record<string, unknown>, perQuestion: [] as unknown[] };
    const rows: Record<string, Array<{ id: string; rank: number }>> = { en: [], pt: [], "pt+lex": [] };
    for (const q of pt) {
      const row: Record<string, unknown> = { id: q.id, query: q.query, names: englishNamesIn(q.query, lexicon) };
      for (const mode of Object.keys(rows)) {
        const titles = [...new Set((await ranked(mode, q)).map((h) => `${h.source}|${h.title.toLowerCase()}`))];
        const rank = titles.findIndex((t) => q.gold.some((g) => g.title && t === `${g.source}|${g.title.toLowerCase()}`));
        rows[mode].push({ id: q.id, rank });
        row[mode] = rank;
      }
      (out.perQuestion as unknown[]).push(row);
    }
    for (const [mode, r] of Object.entries(rows)) {
      const at = (k: number) => +(r.filter((x) => x.rank >= 0 && x.rank < k).length / r.length).toFixed(3);
      (out.modes as Record<string, unknown>)[mode] = { "recall@1": at(1), "recall@3": at(3), "recall@6": at(6) };
    }
    console.log(JSON.stringify(out.modes));
    if (env.BOAR_PT_OUT) writeFileSync(env.BOAR_PT_OUT, JSON.stringify(out, null, 1));
  }, 600000);
});
