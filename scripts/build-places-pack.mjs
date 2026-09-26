#!/usr/bin/env node
// Builds the world gazetteer for offline place names ("restaurants in Lisbon"):
// GeoNames cities with 15,000+ people, their alternate names, country, time
// zone and population, in one small SQLite file. It answers "where is X" even
// where no POI pack is installed, so the app can say it has no data for X
// instead of listing somewhere else. GeoNames data is CC BY 4.0.
//
//   curl -LO https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
//   curl -LO https://download.geonames.org/export/dump/countryInfo.txt
//   node scripts/build-places-pack.mjs cities15000.txt countryInfo.txt world-places.sqlite
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [citiesFile, countryFile, out] = process.argv.slice(2);
if (!out) throw new Error("usage: build-places-pack.mjs cities15000.txt countryInfo.txt out.sqlite");
const countries = new Map(
  readFileSync(countryFile, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => {
    const f = l.split("\t");
    return [f[0], f[4]];
  })
);
rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec(`
  PRAGMA journal_mode = OFF; PRAGMA page_size = 4096;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL, ascii TEXT NOT NULL, country TEXT, country_code TEXT,
                       lat REAL NOT NULL, lon REAL NOT NULL, population INTEGER NOT NULL, tz TEXT, feature TEXT);
  -- names: the name, its ASCII form and alternate names, one row each, for exact lookups.
  CREATE TABLE names (name TEXT NOT NULL COLLATE NOCASE, place_id INTEGER NOT NULL);
`);
const insPlace = db.prepare("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?)");
const insName = db.prepare("INSERT INTO names VALUES (?, ?)");
let n = 0;
let names = 0;
db.exec("BEGIN");
for (const line of readFileSync(citiesFile, "utf8").split("\n")) {
  const f = line.split("\t");
  if (f.length < 19) continue;
  const [id, name, ascii, alternates, lat, lon, , feature, cc, , , , , , population, , , tz] = f;
  insPlace.run(Number(id), name, ascii, countries.get(cc) ?? cc, cc, Number(lat), Number(lon), Number(population) || 0, tz, feature);
  const all = new Set([name, ascii, ...alternates.split(",")].map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 80));
  for (const a of all) (insName.run(a, Number(id)), names++);
  n++;
}
db.exec("COMMIT; CREATE INDEX names_name ON names (name); CREATE INDEX places_latlon ON places (lat, lon);");
const meta = { format: "boar-places-pack", formatVersion: 1, source: "GeoNames cities15000", license: "CC BY 4.0 (GeoNames)", places: n, builtAt: new Date().toISOString() };
const setMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
for (const [k, v] of Object.entries(meta)) setMeta.run(k, String(v));
db.exec("VACUUM");
db.close();
const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
const summary = { file: out, sizeBytes: statSync(out).size, sha256: sha, places: n, names };
writeFileSync(`${out}.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
