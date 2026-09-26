#!/usr/bin/env node
// Builds eval/retrieval/questions.<version>.jsonl: known-item retrieval
// questions for articles sampled from a format-2 knowledge pack. Two steps,
// no network:
//
//   1. --leads-out leads.json: samples articles per popularity stratum
//      (deterministic seed) and writes their leads.
//   2. Someone writes two questions per article from its lead, as
//      {"<article id>": {"named": "...", "descriptive": "..."}}: "named"
//      mentions the subject, "descriptive" describes it without the title's
//      distinctive words. --written that.json --writer "<who>" assembles the
//      set (same seed, same sample).
//
// The gold answer is the article. Schema shared with the answer-quality set
// (eval/dataset, Sextant): id, category, query, lang, gold, license, source_url, notes.
//
//   node eval/retrieval/make-questions.mjs --pack PACK.sqlite --leads-out leads.json [--per-stratum 20] [--seed 1]
//   node eval/retrieval/make-questions.mjs --pack PACK.sqlite --out questions.v1.jsonl --written q.json --writer "..." [--per-stratum 20] [--seed 1]
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";

const { values: o } = parseArgs({
  options: {
    pack: { type: "string" },
    out: { type: "string" },
    "per-stratum": { type: "string", default: "30" },
    seed: { type: "string", default: "1" },
    "leads-out": { type: "string" },
    written: { type: "string" },
    writer: { type: "string" },
  },
});
if (!o.pack || (!o["leads-out"] && !(o.out && o.written && o.writer))) {
  throw new Error("use --pack with --leads-out, or with --out --written --writer");
}
const written = o.written ? JSON.parse(readFileSync(o.written, "utf8")) : null;

// Deterministic sampling (mulberry32), so the same seed picks the same articles.
let s = Number(o.seed) >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const db = new DatabaseSync(o.pack, { readOnly: true });
const block = db.prepare("SELECT zdata FROM blocks WHERE id = ?");
const text = (a) => zstdDecompressSync(block.get(a.block_id).zdata).subarray(a.off, a.off + a.len).toString("utf8");
const lead = (t) =>
  t.split("\n\n").filter((p) => p.trim() && !p.startsWith("#") && !p.startsWith("Key facts:")).slice(0, 3).join("\n\n").slice(0, 1800);

const STRATA = [
  { name: "head", source: 0, where: "views >= 5000" },
  { name: "tail", source: 0, where: "views > 0 AND views < 5000" },
  { name: "unviewed", source: 0, where: "views = 0" },
  { name: "voyage", source: 1, where: "1 = 1" },
];
const per = Number(o["per-stratum"]);
const picked = [];
for (const st of STRATA) {
  const ids = db.prepare(`SELECT id FROM articles WHERE source = ? AND ${st.where} AND title NOT LIKE 'List of%'`).all(st.source).map((r) => r.id);
  const chosen = new Set();
  let tries = 0;
  while (chosen.size < per && tries++ < per * 20 && ids.length) {
    const id = ids[Math.floor(rand() * ids.length)];
    if (chosen.has(id)) continue;
    const a = db.prepare("SELECT id, title, views, source, block_id, off, len FROM articles WHERE id = ?").get(id);
    const l = lead(text(a));
    if (l.length < 300) continue;
    chosen.add(id);
    picked.push({ stratum: st.name, a, lead: l });
  }
}
console.log(`sampled ${picked.length} articles`);
if (o["leads-out"]) {
  writeFileSync(o["leads-out"], JSON.stringify(picked.map((p) => ({ id: p.a.id, stratum: p.stratum, source: p.a.source === 1 ? "enwikivoyage" : "enwiki", title: p.a.title, lead: p.lead })), null, 1));
  console.log(`wrote the sampled leads to ${o["leads-out"]}`);
  process.exit(0);
}

const rows = [];
for (const p of picked) {
  const q = written[p.a.id] ?? {};
  const src = p.a.source === 1 ? "enwikivoyage" : "enwiki";
  const host = p.a.source === 1 ? "en.wikivoyage.org" : "en.wikipedia.org";
  for (const kind of ["named", "descriptive"]) {
    if (!q[kind]) continue;
    rows.push({
      id: `ret-${p.stratum}-${kind}-${String(p.a.id).padStart(8, "0")}`,
      category: `retrieval-${kind}-${p.stratum}`,
      query: q[kind].trim(),
      lang: "en",
      gold: [{ source: src, title: p.a.title }],
      license: "CC BY-SA 4.0 (question derived from the article's lead)",
      source_url: `https://${host}/wiki/${encodeURIComponent(p.a.title.replace(/ /g, "_"))}`,
      notes: `views/month=${p.a.views}; written by ${o.writer} from the lead`,
    });
  }
}
rows.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(o.out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} questions to ${o.out}`);
