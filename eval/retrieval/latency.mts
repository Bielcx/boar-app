// Search latency with several format-2 packs installed, measured the way the app searches them: one pack after the
// other (searchWikiPacks in src/rag/packs.ts), each with WikiPack.searchDetailed, no query vector (the default path).
// For each N = 1..packs.length: p50/p95 of the total time per question over the question sets, cold (first pass
// after opening) and warm (second pass). Bundle and run where the packs are:
//
//   npx esbuild eval/retrieval/latency.mts --bundle --platform=node --format=esm --outfile=latency.mjs
//   node latency.mjs --packs a.sqlite,b.sqlite,... --questions q1.jsonl,q2.jsonl [--out result.json]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "../../src/rag/testing/nodeSqlite";
import { WikiPack } from "../../src/rag/wikiPack";

const { values: o } = parseArgs({ options: { packs: { type: "string" }, questions: { type: "string" }, out: { type: "string" } } });
if (!o.packs || !o.questions) throw new Error("--packs and --questions are required");
const paths = o.packs.split(",");
const queries = o.questions.split(",").flatMap((f) =>
  readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).query as string)
);

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};

const result: Record<string, unknown> = { packs: paths.map((p) => p.split("/").pop()), questions: queries.length, runs: [] };
for (let n = 1; n <= paths.length; n++) {
  const packs: WikiPack[] = [];
  for (const p of paths.slice(0, n)) packs.push(await WikiPack.open(nodeSqliteDatabase(p), decompress));
  const pass = async () => {
    const times: number[] = [];
    for (const q of queries) {
      const t0 = performance.now();
      for (const wp of packs) await wp.searchDetailed(q, { k: 6 });
      times.push(performance.now() - t0);
    }
    return times;
  };
  const cold = await pass();
  const warm = await pass();
  const run = { n, coldP50: pct(cold, 50), coldP95: pct(cold, 95), warmP50: pct(warm, 50), warmP95: pct(warm, 95) };
  (result.runs as unknown[]).push(run);
  console.log(JSON.stringify(run));
}
if (o.out) writeFileSync(o.out, JSON.stringify(result, null, 1));
