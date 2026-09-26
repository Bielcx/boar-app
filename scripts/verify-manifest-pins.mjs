#!/usr/bin/env node
// Checks every catalog entry in src/models/manifest.ts against its host:
// the pinned URL must resolve, and the host-reported size (and sha256, where
// the host exposes it) must match the manifest. Needs network; not part of
// `npm test`. Usage: node scripts/verify-manifest-pins.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const src = readFileSync(new URL("../src/models/manifest.ts", import.meta.url), "utf8");
const entries = [];
const re = /id:\s*"([^"]+)"[\s\S]*?sizeBytes:\s*(\d+)[\s\S]*?sha256:\s*"([0-9a-f]{64})"[\s\S]*?sourceUrl:\s*"([^"]+)"/g;
for (let m; (m = re.exec(src)); ) entries.push({ id: m[1], size: Number(m[2]), sha256: m[3], url: m[4] });

const HF = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([0-9a-f]{40})\/(.+)$/;
const SMALL_FILE_BYTES = 16 * 1024 * 1024;

async function check(e) {
  const hf = HF.exec(e.url);
  if (hf) {
    const [, repo, rev, path] = hf;
    const res = await fetch(`https://huggingface.co/api/models/${repo}/paths-info/${rev}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ paths: path }),
    });
    if (!res.ok) return `paths-info HTTP ${res.status}`;
    const [info] = await res.json();
    if (!info) return "file not found at pinned revision";
    if (info.size !== e.size) return `size ${info.size} != manifest ${e.size}`;
    if (info.lfs?.oid !== e.sha256) return `sha256 ${info.lfs?.oid} != manifest ${e.sha256}`;
    return null;
  }
  if (e.size <= SMALL_FILE_BYTES) {
    const res = await fetch(e.url);
    if (!res.ok) return `HTTP ${res.status}`;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== e.size) return `size ${buf.length} != manifest ${e.size}`;
    const digest = createHash("sha256").update(buf).digest("hex");
    return digest === e.sha256 ? null : `sha256 ${digest} != manifest ${e.sha256}`;
  }
  // Large non-HF asset (release download): size only, to avoid a big download.
  const res = await fetch(e.url, { method: "HEAD", redirect: "follow" });
  if (!res.ok) return `HTTP ${res.status}`;
  const len = Number(res.headers.get("content-length"));
  return len === e.size ? null : `size ${len} != manifest ${e.size} (sha256 not checked)`;
}

let failed = 0;
for (const e of entries) {
  const err = await check(e).catch((x) => String(x));
  console.log(`${err ? "FAIL" : "ok  "} ${e.id}${err ? ` — ${err}` : ""}`);
  if (err) failed++;
}
if (entries.length === 0) {
  console.error("No catalog entries parsed from manifest.ts");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
