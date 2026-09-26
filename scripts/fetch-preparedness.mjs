#!/usr/bin/env node
// Fetches the sources of the "Emergency and preparedness" knowledge pack into
// JSONL shards for build-wiki-pack.mjs (one document per line: page_id, title,
// text, source, url, license) plus a manifest of every document. Build-time
// only, on a computer; the app never runs this. See docs/KNOWLEDGE_PACKS.md.
//
//   node scripts/fetch-preparedness.mjs build/preparedness
//   node scripts/build-wiki-pack.mjs --out boar-preparedness.sqlite --shards build/preparedness/*.jsonl
//
// Only sources whose license allows redistribution: Wikipedia, Wikibooks,
// Wikivoyage and Appropedia (CC BY-SA 4.0), US federal government pages and
// manuals (public domain, 17 U.S.C. §105). Sites that refuse automated access
// (FEMA, CDC, USDA answer 403) are skipped, not worked around.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanWikivoyage } from "./lib/wiki-pack-lib.mjs";
import { htmlToText } from "./lib/prep-lib.mjs";

const out = process.argv[2] ?? "build/preparedness";
mkdirSync(out, { recursive: true });
const UA = "BOAR-preparedness-pack-builder/0.1 (https://github.com/rferrari/boar-app)";
const BY_SA = "CC BY-SA 4.0";
const PD = "Public domain (US federal government work, 17 U.S.C. §105)";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = true, attempt = 0 } = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const body = await res.text();
  const limited = res.status === 429 || res.status >= 500 || (json && !body.trimStart().startsWith("{"));
  if (limited && attempt < 6) {
    await sleep(5000 * 2 ** attempt);
    return get(url, { json, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return json ? JSON.parse(body) : body;
}

const manifest = [];
function emit(shard, doc) {
  appendFileSync(join(out, `${shard}.jsonl`), `${JSON.stringify(doc)}\n`);
  manifest.push({ source: doc.source, title: doc.title, url: doc.url, license: doc.license, chars: doc.text.length });
}

// Headings in the pack are markdown ("## Treatment"); cleanWikivoyage already writes them.
const SKIP_SECTIONS = /\n#{2,3} (See also|References|Notes|Footnotes|External links|Further reading|Bibliography|Sources)\s*\n[\s\S]*$/;
function wikiText(title, wikitext) {
  const body = cleanWikivoyage(wikitext).replace(SKIP_SECTIONS, "").trim();
  return `# ${title}\n\n${body}`;
}

// ---- MediaWiki sites ----

async function categoryPages(api, roots, depth) {
  const pages = new Set();
  const seenCats = new Set();
  let frontier = roots.map((c) => `Category:${c}`);
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next = [];
    for (const cat of frontier) {
      if (seenCats.has(cat)) continue;
      seenCats.add(cat);
      let cont = {};
      do {
        const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "categorymembers", cmtitle: cat, cmlimit: "500", cmtype: "page|subcat", ...cont });
        const j = await get(`${api}?${q}`);
        for (const m of j.query.categorymembers) {
          if (m.ns === 14) next.push(m.title);
          else if (m.ns === 0) pages.add(m.title);
        }
        cont = j.continue ?? null;
        await sleep(300);
      } while (cont);
    }
    frontier = next;
  }
  return [...pages];
}

async function prefixPages(api, prefixes) {
  const pages = [];
  for (const p of prefixes) {
    let cont = {};
    do {
      const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "allpages", apprefix: p, aplimit: "500", apfilterredir: "nonredirects", ...cont });
      const j = await get(`${api}?${q}`);
      pages.push(...j.query.allpages.map((x) => x.title));
      cont = j.continue ?? null;
      await sleep(300);
    } while (cont);
  }
  return pages;
}

/** Wikitext of up to 50 pages per request; redirects followed, missing pages skipped. */
async function* wikitexts(api, titles) {
  for (let i = 0; i < titles.length; i += 50) {
    const q = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "revisions|info", rvprop: "content|ids", rvslots: "main",
      inprop: "url", redirects: "1", titles: titles.slice(i, i + 50).join("|"),
    });
    const j = await get(`${api}?${q}`);
    for (const p of j.query.pages ?? []) {
      const rev = p.revisions?.[0];
      if (p.missing || !rev) continue;
      yield { id: p.pageid, title: p.title, url: p.fullurl, revid: rev.revid, wikitext: rev.slots.main.content };
    }
    await sleep(1000);
  }
}

async function mediawiki(shard, { api, source, code, titles, minChars = 300 }) {
  const seen = new Set();
  let n = 0;
  for await (const p of wikitexts(api, [...new Set(titles)])) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const text = wikiText(p.title, p.wikitext);
    if (text.length < minChars) continue;
    emit(shard, { page_id: code * 1e9 + p.id, title: p.title, text, source, url: p.url, license: BY_SA, revid: p.revid });
    n++;
  }
  log(`${shard}: ${n} documents`);
}

// ---- US government pages ----

async function govPages(shard, urls, siteName) {
  let n = 0;
  for (const url of urls) {
    try {
      const html = await get(url, { json: false });
      const { title, text } = htmlToText(html);
      if (text.length < 300) continue;
      const id = 4e9 + Math.abs([...url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
      emit(shard, { page_id: id, title: `${title} (${siteName})`, text: `# ${title}\n\n${text}`, source: "usgov", url, license: PD });
      n++;
    } catch (e) {
      log(`skip ${url}: ${e.message}`);
    }
    await sleep(1500);
  }
  log(`${shard}: ${n} pages`);
}

async function readyGovUrls() {
  const xml = await get("https://www.ready.gov/sitemap.xml", { json: false });
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // English guidance pages only: no translations, press, grants, business kits or campaign pages.
  return locs.filter((u) => /^https:\/\/www\.ready\.gov\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(u) && !/\/(es|zh|vi|ko|ht|ar|fr|ru|tl|ja|pl|pt)(\/|$)|press|campaign|grant|ready-business|partners|translations|newsroom|about|contact|privacy|website-policies|foia|accessibility/.test(u));
}

// ---- main ----

const WP_ROOTS = [
  "First aid", "Wilderness medical emergencies", "Survival skills", "Emergency management", "Disaster preparedness",
  "Water treatment", "Food preservation", "Sustainable agriculture", "Permaculture",
];
const APPROPEDIA_ROOTS = ["Water treatment", "Sanitation", "Emergency management", "Food and agriculture", "Agriculture", "Health"];
const VOYAGE = ["Stay healthy", "Stay safe", "Water", "Hiking", "Wilderness backpacking", "Cold weather", "Hot weather", "Earthquake safety"];
const NPS = [
  "https://www.nps.gov/articles/hiking-safety.htm",
];

const which = new Set(process.argv.slice(3));
// Each source rewrites its own shard, so a source can be fetched again on its own.
const want = (s) => {
  if (which.size && !which.has(s)) return false;
  rmSync(join(out, `${s}.jsonl`), { force: true });
  return true;
};

if (want("wikipedia")) {
  const api = "https://en.wikipedia.org/w/api.php";
  const cache = join(out, "wikipedia-titles.json");
  // PREP_WP_TITLES: a vetted title list (scripts/filter-relevance.mjs --titles ... --out) instead of the crawl.
  const titles = process.env.PREP_WP_TITLES
    ? JSON.parse(readFileSync(process.env.PREP_WP_TITLES, "utf8"))
    : existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")) : await categoryPages(api, WP_ROOTS, Number(process.env.PREP_WP_DEPTH ?? 1));
  writeFileSync(cache, JSON.stringify(titles));
  log(`wikipedia: ${titles.length} titles`);
  // PREP_TITLES_ONLY=1: stop after listing, to review the category crawl before fetching text.
  if (!process.env.PREP_TITLES_ONLY) await mediawiki("wikipedia", { api, source: "enwiki", code: 0, titles });
}
if (want("wikibooks")) {
  const api = "https://en.wikibooks.org/w/api.php";
  const titles = ["First Aid", "Outdoor Survival", ...(await prefixPages(api, ["First Aid/", "Outdoor Survival/"]))];
  await mediawiki("wikibooks", { api, source: "enwikibooks", code: 2, titles, minChars: 150 });
}
if (want("wikivoyage")) {
  await mediawiki("wikivoyage", { api: "https://en.wikivoyage.org/w/api.php", source: "enwikivoyage", code: 1, titles: VOYAGE });
}
if (want("appropedia")) {
  const api = "https://www.appropedia.org/w/api.php";
  const titles = await categoryPages(api, APPROPEDIA_ROOTS, 1);
  log(`appropedia: ${titles.length} titles`);
  await mediawiki("appropedia", { api, source: "appropedia", code: 3, titles });
}
if (want("usgov")) {
  const ready = await readyGovUrls();
  log(`ready.gov: ${ready.length} pages`);
  await govPages("usgov", ready, "Ready.gov");
  await govPages("usgov", NPS, "National Park Service");
}
if (want("army-manual")) {
  // US Army FM 21-76 "Survival" (1992): public domain; archive.org item marked Public Domain Mark 1.0. Text only (OCR).
  const fm = await get("https://archive.org/download/USArmyFM2176/US_Army-FM21-76_djvu.txt", { json: false });
  // Table-of-contents entries ("CHAPTER 10 - POISONOUS PLANTS ......") aren't chapters.
  const chapters = fm.split(/\n(?=CHAPTER \d+\b)/).filter((c) => c.trim().length > 500 && !/\.{5,}/.test(c.split("\n")[0]));
  chapters.forEach((c, i) => {
    const head = c.trim().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ").slice(0, 80);
    emit("army-manual", {
      page_id: 4.5e9 + i, title: `US Army Survival Manual FM 21-76: ${head}`, text: `# ${head}\n\n${c.trim()}`, source: "usgov",
      url: "https://archive.org/details/USArmyFM2176", license: "Public domain (US Army FM 21-76, 1992)",
    });
  });
  log(`FM 21-76: ${chapters.length} chapters`);
}

// The manifest lists every document of every shard in the directory (not only this run's).
const all = readdirSync(out)
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => readFileSync(join(out, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .map((d) => ({ source: d.source, title: d.title, url: d.url, license: d.license, chars: d.text.length }));
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(all, null, 1)}\n`);
log(`manifest: ${all.length} documents (${manifest.length} fetched this run)`);
