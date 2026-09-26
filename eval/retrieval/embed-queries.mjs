#!/usr/bin/env node
// Embeds each question of a retrieval set with the app's embedding model
// (as the app embeds a question: the raw text) for recall.test.ts's
// "lead-embedding rerank" configuration. Run where models are allowed to run.
//
//   BOAR_EMBEDDING_GGUF=/path/bge-small-en-v1.5-q8_0.gguf node eval/retrieval/embed-queries.mjs questions.v1.jsonl out.json
import { readFileSync, writeFileSync } from "node:fs";
import { getLlama } from "node-llama-cpp";

const [input, output] = process.argv.slice(2);
const model = process.env.BOAR_EMBEDDING_GGUF;
if (!input || !output || !model) throw new Error("usage: BOAR_EMBEDDING_GGUF=... embed-queries.mjs questions.jsonl out.json");
const questions = readFileSync(input, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const llama = await getLlama({ gpu: false });
const ctx = await (await llama.loadModel({ modelPath: model })).createEmbeddingContext({ contextSize: 512, threads: 4 });
const out = {};
for (const q of questions) out[q.id] = Array.from((await ctx.getEmbeddingFor(q.query)).vector);
writeFileSync(output, JSON.stringify(out));
console.log(`embedded ${questions.length} questions`);
