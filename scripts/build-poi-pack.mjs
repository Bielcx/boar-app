#!/usr/bin/env node
// Builds an offline places pack for one region: food and drink POIs from
// OpenStreetMap (Overpass JSON or an osmium export) plus the Eat/Drink listings
// of the region's Wikivoyage guides, with a grid index for "near me" and FTS
// for names and cuisines. See docs/POI_PACKS.md.
//
//   node scripts/build-poi-pack.mjs --id sao-paulo --name-en "São Paulo" --name-pt "São Paulo" \
//     --bbox=-23.80,-46.83,-23.36,-46.36 --tz America/Sao_Paulo --osm osm-sao-paulo.json \
//     --voyage enwikivoyage-latest-pages-articles.xml.bz2 --voyage-title "São Paulo" --out poi/sao-paulo.sqlite
//
// OSM data is ODbL 1.0 (© OpenStreetMap contributors); Wikivoyage is CC BY-SA 4.0.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { addressOf, categoryOf, cellOf, cuisinesOf, dietOf, voyageListings } from "./lib/poi-pack-lib.mjs";
import { parseDumpPage } from "./lib/wiki-pack-lib.mjs";

const { values: o } = parseArgs({
  options: {
    id: { type: "string" },
    "name-en": { type: "string" },
    "name-pt": { type: "string" },
    bbox: { type: "string" },
    tz: { type: "string", multiple: true, default: [] },
    osm: { type: "string", multiple: true, default: [] },
    voyage: { type: "string" },
    "voyage-title": { type: "string", multiple: true, default: [] },
    places: { type: "string" },
    out: { type: "string" },
  },
});
if (!o.id || !o.bbox || !o.out || !o.osm.length) {
  console.error("usage: build-poi-pack.mjs --id ID --bbox=minLat,minLon,maxLat,maxLon --osm FILE.json --out FILE [--voyage DUMP --voyage-title T] [--places world-places.sqlite]");
  process.exit(1);
}
const bbox = o.bbox.split(",").map(Number);
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

rmSync(o.out, { force: true });
mkdirSync(dirname(o.out), { recursive: true });
const db = new DatabaseSync(o.out);
db.exec(`
  PRAGMA journal_mode = OFF; PRAGMA page_size = 4096;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE pois (
    id INTEGER PRIMARY KEY, ref TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, cell INTEGER NOT NULL,
    name TEXT NOT NULL, category TEXT NOT NULL, cuisine TEXT,
    vegan TEXT, vegetarian TEXT, gluten_free TEXT, halal TEXT, kosher TEXT,
    address TEXT, opening_hours TEXT, phone TEXT, website TEXT, description TEXT,
    approx INTEGER NOT NULL DEFAULT 0, source INTEGER NOT NULL, source_title TEXT
  );
  CREATE VIRTUAL TABLE pois_fts USING fts5(name, cuisine, category, description, content='pois', content_rowid='id',
                                           tokenize='unicode61 remove_diacritics 2');
`);
const ins = db.prepare(`INSERT INTO pois (ref, lat, lon, cell, name, category, cuisine, vegan, vegetarian, gluten_free, halal, kosher,
  address, opening_hours, phone, website, description, approx, source, source_title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const stats = { osm: 0, osmSkippedUnnamed: 0, voyage: 0, voyageApprox: 0, vegan: 0, vegetarian: 0 };
const osmDates = [];
db.exec("BEGIN");
for (const file of o.osm) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  if (j.osm3s?.timestamp_osm_base) osmDates.push(j.osm3s.timestamp_osm_base);
  const seen = new Set();
  for (const e of j.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const ref = `osm:${e.type}/${e.id}`;
    if (lat == null || seen.has(ref)) continue;
    // --bbox also cuts: a city pack can be built from its region's OSM export.
    if (lat < bbox[0] || lat > bbox[2] || lon < bbox[1] || lon > bbox[3]) continue;
    seen.add(ref);
    // A place without a name can't be named in an answer.
    if (!t.name) {
      stats.osmSkippedUnnamed++;
      continue;
    }
    const diet = dietOf(t);
    if (diet.vegan && diet.vegan !== "no") stats.vegan++;
    if (diet.vegetarian && diet.vegetarian !== "no") stats.vegetarian++;
    ins.run(ref, lat, lon, cellOf(lat, lon), t.name, categoryOf(t), cuisinesOf(t).join(";") || null,
      diet.vegan ?? null, diet.vegetarian ?? null, diet.gluten_free ?? null, diet.halal ?? null, diet.kosher ?? null,
      addressOf(t), t.opening_hours ?? null, t.phone ?? t["contact:phone"] ?? null, t.website ?? t["contact:website"] ?? null,
      null, 0, 0, null);
    stats.osm++;
  }
}

// Wikivoyage: the region's guide and its districts ("São Paulo", "São Paulo/Centro", ...).
if (o.voyage && o["voyage-title"].length) {
  const wanted = (title) => o["voyage-title"].some((t) => title === t || title.startsWith(`${t}/`));
  const coords = new Map(); // article title → [lat, lon] from {{geo|lat|lon}}
  const child = spawn("bzcat", [o.voyage], { stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.setEncoding("utf8");
  let buf = "";
  for await (const piece of child.stdout) {
    buf += piece;
    let end;
    while ((end = buf.indexOf("</page>")) >= 0) {
      const xml = buf.slice(buf.indexOf("<page>"), end);
      buf = buf.slice(end + 7);
      const title = xml.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/&amp;/g, "&");
      if (!title || !wanted(title)) continue;
      const page = parseDumpPage(xml);
      if (page.ns !== "0" || page.redirect) continue;
      const geo = page.text.match(/\{\{\s*geo\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)/i);
      const at = geo ? [Number(geo[1]), Number(geo[2])] : coords.get(title.split("/")[0]);
      if (geo) coords.set(title, at);
      for (const [n, l] of voyageListings(page.text).entries()) {
        const exact = l.lat != null;
        const lat = exact ? l.lat : at?.[0];
        const lon = exact ? l.lon : at?.[1];
        if (lat == null || lat < bbox[0] || lat > bbox[2] || lon < bbox[1] || lon > bbox[3]) continue;
        const description = [l.content, l.price && `Price: ${l.price}`].filter(Boolean).join(" ");
        ins.run(`wikivoyage:${title}#${n}`, lat, lon, cellOf(lat, lon), l.name, "listing", l.section.toLowerCase(),
          null, null, null, null, null, l.address, l.hours, l.phone, l.url, description || null, exact ? 0 : 1, 1, `${title} (${l.section})`);
        stats.voyage++;
        if (!exact) stats.voyageApprox++;
      }
    }
  }
  log(`wikivoyage: ${stats.voyage} listings (${stats.voyageApprox} without their own coordinates)`);
}
db.exec("COMMIT");
db.exec("CREATE INDEX pois_cell ON pois (cell); INSERT INTO pois_fts (pois_fts) VALUES ('rebuild'); INSERT INTO pois_fts (pois_fts) VALUES ('optimize');");

// The region's biggest places (from the world gazetteer), for the catalog and the UI.
let cities = [];
if (o.places) {
  const p = new DatabaseSync(o.places, { readOnly: true });
  cities = p.prepare(`SELECT name, lat, lon, population FROM places WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY population DESC LIMIT 10`)
    .all(bbox[0], bbox[2], bbox[1], bbox[3]);
  p.close();
}
const count = (cell) => db.prepare("SELECT COUNT(*) AS n FROM pois WHERE source = 0 AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?").get(cell.lat - 0.05, cell.lat + 0.05, cell.lon - 0.05, cell.lon + 0.05).n;
cities = cities.map((c) => ({ name: c.name, lat: c.lat, lon: c.lon, pois: count(c) }));

const osmDate = osmDates.sort()[0] ?? "";
const meta = {
  format: "boar-poi-pack",
  formatVersion: 1,
  id: o.id,
  nameEn: o["name-en"] ?? o.id,
  namePt: o["name-pt"] ?? o["name-en"] ?? o.id,
  bbox: JSON.stringify(bbox),
  timeZones: JSON.stringify(o.tz),
  osmDate,
  voyageDump: o.voyage ? o.voyage.split("/").pop() : "",
  license: "ODbL 1.0 (© OpenStreetMap contributors) + CC BY-SA 4.0 (Wikivoyage)",
  poiCount: stats.osm + stats.voyage,
  cities: JSON.stringify(cities),
  builtAt: new Date().toISOString(),
};
const setMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
for (const [k, v] of Object.entries(meta)) setMeta.run(k, String(v));
db.exec("VACUUM");
db.close();

const sha = createHash("sha256");
await new Promise((ok, fail) => createReadStream(o.out).on("data", (d) => sha.update(d)).on("end", ok).on("error", fail));
const summary = { id: o.id, file: o.out, sizeBytes: statSync(o.out).size, sha256: sha.digest("hex"), osmDate, ...stats, cities };
writeFileSync(`${o.out}.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
