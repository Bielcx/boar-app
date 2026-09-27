/// <reference types="node" />
/**
 * Portuguese questions that name a standard by number (EIP-1559, ERC-20, BIP-32): rank of the page whose title has
 * that number, over the crypto pack, the way retrieve() searches (see pt.test.ts), with the lexicon's names only
 * (before) and with the identifier first (retrieve() now). Skipped unless the env points at the files:
 *
 *   BOAR_EIP_PACK=boar-crypto.sqlite BOAR_EIP_QUESTIONS=questions.v2-pt.jsonl BOAR_PT_LEXICON=pt-en.json \
 *     [BOAR_EIP_OUT=out.json] npx vitest run eval/retrieval/eip-pt.test.ts
 */
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "../../src/rag/testing/nodeSqlite";
import { WikiPack, type PackHit } from "../../src/rag/wikiPack";
import { englishNamesIn, type Lexicon } from "../../src/rag/ptLexicon";
import { identifiersIn, titleHasIdentifier } from "../../src/rag/identifiers";

const env = process.env;

describe.skipIf(!env.BOAR_EIP_PACK)("standards named by number in Portuguese", () => {
  it("ranks the standard's page", async () => {
    const pack = await WikiPack.open(nodeSqliteDatabase(env.BOAR_EIP_PACK!), decompress);
    const lexicon: Lexicon = JSON.parse(readFileSync(env.BOAR_PT_LEXICON!, "utf8"));
    const qs = readFileSync(env.BOAR_EIP_QUESTIONS!, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; query: string });
    const search = async (query: string, titles: string[] = []) => {
      const hits = await pack.search(query, { k: 6, titles });
      return [...hits.filter((h) => h.via === "title"), ...hits.filter((h) => h.via !== "title")];
    };
    const rows: Array<{ id: string; ids: string; lexicon: string; before: number; after: number }> = [];
    for (const q of qs) {
      const ids = identifiersIn(q.query);
      if (!ids.length) continue;
      const lex = englishNamesIn(q.query, lexicon);
      const main = await search(q.query);
      const rankOf = (hits: PackHit[]) => [...new Set(hits.map((h) => h.title))].findIndex((t) => titleHasIdentifier(t, ids[0]));
      const run = async (names: string[], idsFirst: boolean) => {
        const extra = await search(names.join(" "), names);
        const merged = [...extra.slice(0, 4), ...main, ...extra];
        if (!idsFirst) return rankOf(merged);
        const byId = (h: PackHit) => ids.some((id) => titleHasIdentifier(h.title, id));
        return rankOf([...merged.filter(byId), ...merged.filter((h) => !byId(h))]);
      };
      rows.push({ id: q.id, ids: ids.join(","), lexicon: lex.join("|"), before: lex.length ? await run(lex, false) : rankOf(main), after: await run([...ids, ...lex.filter((n) => !ids.includes(n))], true) });
    }
    const at1 = (k: "before" | "after") => rows.filter((r) => r[k] === 0).length;
    const out = { questions: rows.length, "before@1": at1("before"), "after@1": at1("after"), rows };
    console.log(JSON.stringify(out));
    if (env.BOAR_EIP_OUT) writeFileSync(env.BOAR_EIP_OUT, JSON.stringify(out, null, 1));
  }, 300000);
});
