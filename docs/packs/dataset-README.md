---
pretty_name: BOAR offline knowledge packs
license: other
license_name: mixed-per-pack
language:
  - en
tags:
  - offline
  - rag
  - sqlite
  - openstreetmap
  - wikipedia
---

# BOAR offline knowledge packs

Data files for [BOAR](https://github.com/rferrari/boar-app), an offline AI research app for iOS and Android.
Each pack is a single SQLite file the app downloads (or imports from a file) and searches on the device, with no network.
The app pins every file to the commit it was uploaded in (`…/resolve/<commit-sha>/<path>`) and checks its SHA-256 and size before use,
so a file here never changes under an installed app: a rebuilt pack is a new commit.

Built by the scripts in the app's repository (`scripts/build-*.mjs`); see `docs/KNOWLEDGE_PACKS.md` and `docs/POI_PACKS.md` there.

## Packs, sources and licenses

Each pack keeps the license of its sources. Share-alike packs stay share-alike; attribution travels with every document
(per-article source URL and license in the pack's `article_meta` table, shown in the app next to each answer).

| Path | What | Sources | License |
|---|---|---|---|
| `places/world-places.sqlite` | Gazetteer: cities and towns with 15,000+ people, to resolve "restaurants in Lisbon" to a place | [GeoNames](https://www.geonames.org) `cities15000` | CC BY 4.0, © GeoNames |
| `places/cities/<city>.sqlite` | Places to eat and drink around one of ten cities (below): name, address, opening hours, coordinates, diet tags (`diet:vegan`, `diet:vegetarian`), cuisine; plus Wikivoyage "Eat"/"Drink" listings | [OpenStreetMap](https://www.openstreetmap.org/copyright) via [Geofabrik](https://download.geofabrik.de) extracts; [Wikivoyage](https://en.wikivoyage.org) | ODbL 1.0, © OpenStreetMap contributors (database); CC BY-SA 4.0 (Wikivoyage text) |
| `places/tiles/…` | The same places for the whole world as 1°×1° tiles (coming) | as above | as above |
| `topics/boar-preparedness.sqlite` | Emergency and preparedness: first aid, survival, disasters, water, food preservation, self-sufficiency | Wikipedia, Wikibooks (First Aid, Outdoor Survival), Wikivoyage, [Appropedia](https://www.appropedia.org); Ready.gov and the US National Park Service; US Army FM 21-76 *Survival* (1992) | CC BY-SA 4.0 (wiki sources); public domain (US government works, 17 U.S.C. §105) |
| `topics/boar-preparedness.manifest.json` | Every document in the preparedness pack with its source URL and license | — | — |

Coming next (listed here when uploaded):

| Path | What | Sources | License |
|---|---|---|---|
| `topics/boar-crypto.sqlite` | Ethereum and cryptography | Ethereum EIPs and ERCs, consensus/execution specs (CC0 1.0); Ethereum Yellow Paper (CC BY-SA 4.0); ethereum.org content (MIT); Bitcoin BIPs whose header names a permissive license; Wikipedia cryptography and blockchain categories (CC BY-SA 4.0) | per document, recorded in the pack |
| `wiki/en/boar-wiki-en-NN.sqlite` | English Wikipedia, sharded, plus Wikivoyage | Wikipedia via [HuggingFaceFW/finewiki](https://huggingface.co/datasets/HuggingFaceFW/finewiki); Wikivoyage dump | CC BY-SA 4.0 |

### Which cities have a places pack

Ten metropolitan areas, each a box of about 20 km around the city (the 1°×1° world tiles, coming, cover everything else):

- Chosen by hand as the first samples: São Paulo, Singapore, Taipei, Buenos Aires, Berlin.
- **Drawn at random**, to test cities nobody picked: GeoNames `cities15000` with a population of 1,000,000 or more (568 cities),
  minus the five above, sorted by GeoNames id, shuffled with Fisher-Yates and the mulberry32 generator, **seed 20261003**, first five taken
  (`node scripts/draw-poi-cities.mjs --cities cities15000.txt --seed 20261003 --n 5 --exclude sao-paulo,singapore,taipei,buenos-aires,berlin`).
  The draw gave Edmonton, Qujing, Queens, Biên Hòa and Ciudad Nezahualcóyotl.

| City | Places (OSM) | Tagged vegan | Wikivoyage listings | OSM data as of |
|---|---|---|---|---|
| Edmonton | 2,409 | 12 | 111 | 2026-09-26 |
| Qujing | **0** | 0 | 3 | 2026-09-26 |
| Queens (with parts of Brooklyn and Manhattan) | 19,963 | 665 | 48 | 2026-09-26 |
| Biên Hòa (with eastern Ho Chi Minh City) | 3,206 | 266 | 0 | 2026-09-26 |
| Ciudad Nezahualcóyotl (with eastern Mexico City) | 6,098 | 60 | 0 | 2026-09-26 |

OpenStreetMap has almost no restaurants mapped in Qujing, so its pack holds only the Wikivoyage listings, and the app says it has
no offline data for places to eat there instead of making names up.

### Attribution

- **OpenStreetMap:** © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright. The places packs are derived databases under the ODbL.
- **Wikipedia, Wikivoyage, Wikibooks, Appropedia:** text under CC BY-SA 4.0; each document links to its source page, where the list of authors is.
- **GeoNames:** CC BY 4.0, https://www.geonames.org.
- **US government works:** public domain in the United States.

Nothing in these packs is hand-written about the topics the app is evaluated on.

## File format

- Topic and Wikipedia packs: "boar-knowledge-pack" format 2. Text in zstd-compressed blocks, an FTS5 keyword index over passages, redirects/aliases, and binary embeddings (bge-small-en-v1.5) of the leads of the most-read articles. The `meta` table records sources, build parameters and counts.
- Places packs: SQLite with a places table, diet flags and the Wikivoyage listings; see `docs/POI_PACKS.md` in the app repository.

Sizes and SHA-256 of every file are in the app's catalog and in this repository's commit history.
