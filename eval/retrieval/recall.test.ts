/// <reference types="node" />
/**
 * Retrieval quality on a format-2 knowledge pack: recall@k and MRR of the
 * gold article for each question in eval/retrieval/questions.*.jsonl, per
 * ranking configuration and question category, plus search latency on this
 * computer. Skipped unless BOAR_EVAL_PACK points at a pack:
 *
 *   BOAR_EVAL_PACK=/path/pack.sqlite [BOAR_EVAL_QUESTIONS=eval/retrieval/questions.v1.jsonl] \
 *     [BOAR_EVAL_QVECS=/path/query-vectors.json] npx vitest run eval/retrieval/recall.test.ts
 *
 * BOAR_EVAL_CONFIGS=name1,name2 runs only those configurations (substring match).
 * Questions are split by the gold article id: odd = "dev" (where ranking
 * constants may be tuned), even = "test" (reported, never tuned on).
 *
 * Writes eval/retrieval/results/<pack>-<questions>.json.
 */
import { describe, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "../../src/rag/testing/nodeSqlite";
import { DEFAULT_TUNING, WikiPack, type PackHit, type PackTuning } from "../../src/rag/wikiPack";
import { buildLexicalQuery, filterByTermCoverage } from "../../src/rag/pure";

const PACK = process.env.BOAR_EVAL_PACK;
const QUESTIONS = process.env.BOAR_EVAL_QUESTIONS ?? "eval/retrieval/questions.v1.jsonl";
const QVECS = process.env.BOAR_EVAL_QVECS;

interface Question {
  id: string;
  category: string;
  query: string;
  gold: Array<{ source: "enwiki" | "enwikivoyage"; title: string }>;
}

type Ranked = Array<{ title: string; source: string }>;
type Config = (q: Question) => Promise<Ranked>;

const K = [1, 3, 6];

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

/** Article order of a passage list (first occurrence wins). */
function articles(hits: PackHit[]): Ranked {
  const seen = new Set<string>();
  const out: Ranked = [];
  for (const h of hits) {
    const key = `${h.source}:${h.title}`;
    if (!seen.has(key)) (seen.add(key), out.push({ title: h.title, source: h.source }));
  }
  return out;
}

describe.skipIf(!PACK)("retrieval recall on a knowledge pack", () => {
  it("measures recall@k per configuration", async () => {
    const db = nodeSqliteDatabase(PACK!);
    const pack = await WikiPack.open(db as any, decompress);
    const questions: Question[] = readFileSync(QUESTIONS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const qvecs: Record<string, number[]> | null = QVECS && existsSync(QVECS) ? JSON.parse(readFileSync(QVECS, "utf8")) : null;

    // Baseline: what format-1 pack search did (content words OR-ed, plain bm25 over all
    // columns, top 100, then the term-coverage gate on title + text).
    const v1: Config = async (q) => {
      const lq = buildLexicalQuery(q.query);
      if (!lq) return [];
      const rows = db.raw
        .prepare(
          `SELECT f.rowid AS id, f.s, c.article_id, c.start, c.end FROM
           (SELECT rowid, bm25(fts) AS s FROM fts WHERE fts MATCH ? ORDER BY s LIMIT 100) f
           JOIN chunks c ON c.id = f.rowid ORDER BY f.s`
        )
        .all(lq.match) as Array<{ article_id: number; start: number; end: number }>;
      const withText = [];
      for (const r of rows) {
        const a = await pack.article(r.article_id);
        withText.push({ title: a.title, source: a.source, body: a.text.slice(r.start, r.end) });
      }
      return articles(filterByTermCoverage(withText, lq.terms) as any);
    };
    const bm25Only: Config = async (q) => articles(await pack.bm25(await pack.stems(q.query)));
    const full: Config = async (q) => articles(await pack.search(q.query, { k: 10 }));

    const configs: Record<string, Config> = { "v1-baseline": v1, "bm25+title-weight+popularity": bm25Only, "full (named titles first)": full };
    // BOAR_EVAL_GRID=1: ranking constants to compare on the dev half.
    if (process.env.BOAR_EVAL_GRID) {
      const grid: Array<[string, Partial<PackTuning>]> = [
        ["w1,1,1 p0", { weights: [1, 1, 1], prior: 0 }],
        ["w2,1,1 p0", { weights: [2, 1, 1], prior: 0 }],
        ["w2,1,1 p0.5", { weights: [2, 1, 1], prior: 0.5 }],
        ["w4,2,1 p0.5", { weights: [4, 2, 1], prior: 0.5 }],
        ["w8,3,1 p2", { weights: [8, 3, 1], prior: 2 }],
        ["w2,1,1 p0.5 share0.5", { weights: [2, 1, 1], prior: 0.5, namedMinShare: 0.5 }],
        ["w2,1,1 p0.5 pool200", { weights: [2, 1, 1], prior: 0.5, pool: 200 }],
      ];
      for (const [label, t] of grid) {
        configs[`grid ${label}`] = async (q) => {
          pack.tuning = { ...DEFAULT_TUNING, ...t };
          try {
            return articles(await pack.search(q.query, { k: 10 }));
          } finally {
            pack.tuning = { ...DEFAULT_TUNING };
          }
        };
      }
    }
    if (qvecs) {
      configs["full + lead-embedding rerank"] = async (q) =>
        articles(await pack.search(q.query, { k: 10, queryVec: Float32Array.from(qvecs[q.id] ?? []) }));
    }

    const only = process.env.BOAR_EVAL_CONFIGS?.split(",").map((x: string) => x.trim().toLowerCase());
    const results: Record<string, any> = {};
    const splitOf = (id: string) => (Number(id.match(/(\d+)$/)?.[1] ?? 0) % 2 ? "dev" : "test");
    for (const [name, run] of Object.entries(configs)) {
      if (only && !only.some((o: string) => name.toLowerCase().includes(o))) continue;
      const per: Array<{ id: string; category: string; rank: number; ms: number }> = [];
      for (const q of questions) {
        const t = performance.now();
        const ranked = await run(q);
        const ms = performance.now() - t;
        const rank = ranked.findIndex((r) => q.gold.some((g) => g.source === r.source && g.title.toLowerCase() === r.title.toLowerCase()));
        per.push({ id: q.id, category: q.category, rank: rank < 0 ? Infinity : rank + 1, ms });
      }
      const summarize = (rows: typeof per) => ({
        n: rows.length,
        ...Object.fromEntries(K.map((k) => [`recall@${k}`, +(rows.filter((r) => r.rank <= k).length / rows.length).toFixed(3)])),
        mrr10: +(rows.reduce((s, r) => s + (r.rank <= 10 ? 1 / r.rank : 0), 0) / rows.length).toFixed(3),
        p50ms: +percentile(rows.map((r) => r.ms), 50).toFixed(1),
        p95ms: +percentile(rows.map((r) => r.ms), 95).toFixed(1),
      });
      const byCategory = Object.fromEntries(
        [...new Set(per.map((r) => r.category))].sort().map((c) => [c, summarize(per.filter((r) => r.category === c))])
      );
      results[name] = {
        all: summarize(per),
        dev: summarize(per.filter((r) => splitOf(r.id) === "dev")),
        test: summarize(per.filter((r) => splitOf(r.id) === "test")),
        byCategory,
        misses: per.filter((r) => r.rank > 6).map((r) => r.id),
      };
    }

    const suffix = only ? `-${only.join("+").replace(/[^a-z0-9+]+/g, "_")}` : "";
    const out = join("eval/retrieval/results", `${basename(PACK!, ".sqlite")}-${basename(QUESTIONS, ".jsonl")}${suffix}.json`);
    mkdirSync("eval/retrieval/results", { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify({ pack: basename(PACK!), packMeta: pack.meta, questions: QUESTIONS, n: questions.length, measuredAt: new Date().toISOString(), results }, null, 2)}\n`
    );
    for (const part of ["all", "dev", "test"]) {
      console.log(part);
      console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v[part]])));
    }
  }, 3_600_000);
});
