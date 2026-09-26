/**
 * Catalog of offline places packs (scripts/build-poi-pack.mjs), one per
 * region, and the pure helpers the UI uses to suggest one. No native imports.
 *
 * The entries below are the SAMPLE build of 2026-09-26 (five metropolitan
 * areas), generated from each pack's .json summary: sizes, SHA-256 and counts
 * are measured, not estimated. `sourceUrl` is empty until the packs are hosted
 * (release assets); until then they're installed with `npm run pack:push`.
 */
import type { CatalogModel } from "../models/manifest";

export interface PoiRegion {
  id: string;
  name: { en: string; pt: string };
  sizeBytes: number;
  sha256: string;
  /** Empty until the pack is hosted. */
  sourceUrl: string;
  /** Relative to the app's documents directory. */
  filename: string;
  /** OSM places with a name plus Wikivoyage Eat/Drink listings. */
  poiCount: number;
  /** Places tagged diet:vegan (yes/only/limited) or cuisine=vegan. */
  veganCount: number;
  vegetarianCount: number;
  /** The region's biggest places (GeoNames) and how many food POIs lie within ~5 km of each. */
  cities: Array<{ name: string; lat: number; lon: number; pois: number }>;
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number];
  timeZones: string[];
  /** OSM replication timestamp of the data. */
  osmDate: string;
  builtAt: string;
}

export const POI_LICENSE = "ODbL 1.0 (© OpenStreetMap contributors) + CC BY-SA 4.0 (Wikivoyage)";

/** The world gazetteer used to resolve place names ("restaurants in Lisbon"), shipped with any places pack. */
export const WORLD_PLACES = {
  filename: "poi/world-places.sqlite",
  sizeBytes: 20811776,
  sha256: "fdb302aa2a2813ad36487b4f0ffa629ba21faec700ee5fcb5c4bf9c3448e9746",
  license: "CC BY 4.0 (GeoNames)",
  places: 34149,
};

export const POI_REGIONS: PoiRegion[] = 
[
  {
    id: "sao-paulo",
    name: {
      en: "São Paulo",
      pt: "São Paulo"
    },
    sizeBytes: 1363968,
    sha256: "d65a47d84a8ef6e6a8c4d3dedc4247d9bf7ad70536ebe68d09435bcc5a626551",
    sourceUrl: "",
    filename: "poi/sao-paulo.sqlite",
    poiCount: 7013,
    veganCount: 126,
    vegetarianCount: 105,
    cities: [
      {
        name: "São Paulo",
        lat: -23.5475,
        lon: -46.6361,
        pois: 2785
      },
      {
        name: "Guarulhos",
        lat: -23.4628,
        lon: -46.5333,
        pois: 222
      },
      {
        name: "São Bernardo do Campo",
        lat: -23.6939,
        lon: -46.565,
        pois: 785
      },
      {
        name: "Osasco",
        lat: -23.5325,
        lon: -46.7917,
        pois: 147
      },
      {
        name: "Santo André",
        lat: -23.6639,
        lon: -46.5383,
        pois: 806
      },
      {
        name: "Mauá",
        lat: -23.6678,
        lon: -46.4614,
        pois: 124
      },
      {
        name: "Diadema",
        lat: -23.6861,
        lon: -46.6228,
        pois: 241
      },
      {
        name: "Grajaú",
        lat: -23.7698,
        lon: -46.6711,
        pois: 25
      },
      {
        name: "Jardim Angela",
        lat: -23.7164,
        lon: -46.7687,
        pois: 80
      },
      {
        name: "Taboão da Serra",
        lat: -23.6261,
        lon: -46.7917,
        pois: 105
      }
    ],
    bbox: [
      -23.8,
      -46.83,
      -23.36,
      -46.36
    ],
    timeZones: [
      "America/Sao_Paulo"
    ],
    osmDate: "2026-09-26T20:23:48Z",
    builtAt: "2026-09-26T20:27:54.124Z"
  },
  {
    id: "singapore",
    name: {
      en: "Singapore",
      pt: "Singapura"
    },
    sizeBytes: 1839104,
    sha256: "1dffb16051883cf336b858b9e8f3f8a66863732d097347a625f36575c654ce06",
    sourceUrl: "",
    filename: "poi/singapore.sqlite",
    poiCount: 10189,
    veganCount: 97,
    vegetarianCount: 277,
    cities: [
      {
        name: "Singapore",
        lat: 1.2897,
        lon: 103.8501,
        pois: 5287
      },
      {
        name: "Johor Bahru",
        lat: 1.4655,
        lon: 103.7578,
        pois: 392
      },
      {
        name: "Iskandar Puteri",
        lat: 1.3932,
        lon: 103.6232,
        pois: 99
      },
      {
        name: "Pasir Gudang",
        lat: 1.462,
        lon: 103.9053,
        pois: 79
      },
      {
        name: "Bedok New Town",
        lat: 1.3264,
        lon: 103.9417,
        pois: 1429
      },
      {
        name: "Ulu Bedok",
        lat: 1.3333,
        lon: 103.9333,
        pois: 1578
      },
      {
        name: "Sengkang New Town",
        lat: 1.3917,
        lon: 103.8944,
        pois: 1132
      },
      {
        name: "Tampines Estate",
        lat: 1.3581,
        lon: 103.9403,
        pois: 1542
      },
      {
        name: "Jurong Town",
        lat: 1.3342,
        lon: 103.7228,
        pois: 821
      },
      {
        name: "Tampines New Town",
        lat: 1.3492,
        lon: 103.9497,
        pois: 1273
      }
    ],
    bbox: [
      1.16,
      103.59,
      1.48,
      104.1
    ],
    timeZones: [
      "Asia/Singapore"
    ],
    osmDate: "2026-09-26T20:24:49Z",
    builtAt: "2026-09-26T20:29:54.712Z"
  },
  {
    id: "taipei",
    name: {
      en: "Taipei",
      pt: "Taipé"
    },
    sizeBytes: 3321856,
    sha256: "d82c4102e4fedc3371d1680c5cc396a95aa2d2ea2a027cc2d7231e306707dd30",
    sourceUrl: "",
    filename: "poi/taipei.sqlite",
    poiCount: 18857,
    veganCount: 156,
    vegetarianCount: 407,
    cities: [
      {
        name: "Taipei",
        lat: 25.0531,
        lon: 121.5264,
        pois: 11828
      },
      {
        name: "New Taipei City",
        lat: 25.062,
        lon: 121.457,
        pois: 2768
      },
      {
        name: "Banqiao",
        lat: 25.0143,
        lon: 121.4672,
        pois: 4189
      },
      {
        name: "Neihu",
        lat: 25.0815,
        lon: 121.5881,
        pois: 5247
      },
      {
        name: "Xizhi",
        lat: 25.0662,
        lon: 121.6599,
        pois: 627
      }
    ],
    bbox: [
      24.96,
      121.45,
      25.21,
      121.67
    ],
    timeZones: [
      "Asia/Taipei"
    ],
    osmDate: "2026-09-26T20:24:49Z",
    builtAt: "2026-09-26T20:30:10.695Z"
  },
  {
    id: "buenos-aires",
    name: {
      en: "Buenos Aires",
      pt: "Buenos Aires"
    },
    sizeBytes: 1466368,
    sha256: "94178d9daa34b8eec65dde5f773c119fc763aebfb2cac2c5a01104d5ef1191b9",
    sourceUrl: "",
    filename: "poi/buenos-aires.sqlite",
    poiCount: 8050,
    veganCount: 78,
    vegetarianCount: 104,
    cities: [
      {
        name: "Buenos Aires",
        lat: -34.6131,
        lon: -58.3772,
        pois: 3265
      },
      {
        name: "Avellaneda",
        lat: -34.6602,
        lon: -58.3674,
        pois: 1081
      },
      {
        name: "Palermo",
        lat: -34.5886,
        lon: -58.4305,
        pois: 5068
      },
      {
        name: "Lanús",
        lat: -34.7076,
        lon: -58.3913,
        pois: 250
      },
      {
        name: "Balvanera",
        lat: -34.6103,
        lon: -58.3977,
        pois: 4468
      },
      {
        name: "Belgrano",
        lat: -34.5627,
        lon: -58.4583,
        pois: 3749
      },
      {
        name: "Villa Lugano",
        lat: -34.6791,
        lon: -58.4726,
        pois: 515
      },
      {
        name: "Barracas",
        lat: -34.6497,
        lon: -58.3834,
        pois: 1991
      },
      {
        name: "Sarandí",
        lat: -34.6816,
        lon: -58.3464,
        pois: 282
      },
      {
        name: "Colegiales",
        lat: -34.5737,
        lon: -58.4492,
        pois: 4332
      }
    ],
    bbox: [
      -34.71,
      -58.54,
      -34.52,
      -58.33
    ],
    timeZones: [
      "America/Argentina/Buenos_Aires"
    ],
    osmDate: "2026-09-26T20:25:56Z",
    builtAt: "2026-09-26T20:30:32.333Z"
  },
  {
    id: "berlin",
    name: {
      en: "Berlin",
      pt: "Berlim"
    },
    sizeBytes: 3248128,
    sha256: "46e339d27e47a0965c9cc607d3093b5d5039ba3090b778a861d19f9d2ccee2a8",
    sourceUrl: "",
    filename: "poi/berlin.sqlite",
    poiCount: 15279,
    veganCount: 1979,
    vegetarianCount: 3437,
    cities: [
      {
        name: "Berlin",
        lat: 52.5244,
        lon: 13.4105,
        pois: 5993
      },
      {
        name: "Neukölln",
        lat: 52.4772,
        lon: 13.4313,
        pois: 4365
      },
      {
        name: "Kreuzberg",
        lat: 52.4997,
        lon: 13.4034,
        pois: 5867
      },
      {
        name: "Prenzlauer Berg",
        lat: 52.5388,
        lon: 13.4244,
        pois: 5227
      },
      {
        name: "Charlottenburg",
        lat: 52.5167,
        lon: 13.2833,
        pois: 2016
      },
      {
        name: "Schöneberg",
        lat: 52.498,
        lon: 13.3443,
        pois: 4649
      },
      {
        name: "Friedrichshain",
        lat: 52.5156,
        lon: 13.4548,
        pois: 4555
      },
      {
        name: "Marzahn",
        lat: 52.5453,
        lon: 13.5698,
        pois: 333
      },
      {
        name: "Mitte",
        lat: 52.52,
        lon: 13.4049,
        pois: 6083
      },
      {
        name: "Wilmersdorf",
        lat: 52.4833,
        lon: 13.3167,
        pois: 3530
      }
    ],
    bbox: [
      52.33,
      13.08,
      52.68,
      13.77
    ],
    timeZones: [
      "Europe/Berlin"
    ],
    osmDate: "2026-09-26T20:27:59Z",
    builtAt: "2026-09-26T20:30:46.850Z"
  }
];

function area([minLat, minLon, maxLat, maxLon]: PoiRegion["bbox"]): number {
  return (maxLat - minLat) * (maxLon - minLon);
}

/** The smallest region whose area contains the point, or null. */
export function regionForPoint(lat: number, lon: number, regions: PoiRegion[] = POI_REGIONS): PoiRegion | null {
  const inside = regions.filter(({ bbox: [a, b, c, d] }) => lat >= a && lat <= c && lon >= b && lon <= d);
  return inside.sort((x, y) => area(x.bbox) - area(y.bbox))[0] ?? null;
}

/** Regions in the device's time zone (Intl timeZone, e.g. "America/Sao_Paulo"): a guess that needs no permission. */
export function regionsForTimeZone(tz: string, regions: PoiRegion[] = POI_REGIONS): PoiRegion[] {
  return regions.filter((r) => r.timeZones.includes(tz));
}

/** Catalog entries for the download manager (kind "corpus", format "poi-pack"). */
export function poiCatalogEntries(regions: PoiRegion[] = POI_REGIONS): CatalogModel[] {
  return regions.map((r) => ({
    id: `poi-${r.id}`,
    kind: "corpus",
    format: "poi-pack",
    label: r.name.en,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    sourceUrl: r.sourceUrl,
    license: POI_LICENSE,
    description: `${r.poiCount.toLocaleString("en-US")} places to eat and drink (${r.veganCount} tagged vegan), OpenStreetMap ${r.osmDate.slice(0, 10)}`,
    required: false,
  }));
}

/** The world gazetteer as a catalog entry (fixed id), downloaded with any places pack. */
export function worldPlacesEntry(): CatalogModel {
  return {
    id: "poi-world-places",
    kind: "corpus",
    format: "poi-pack",
    label: "World places (GeoNames)",
    filename: WORLD_PLACES.filename,
    sizeBytes: WORLD_PLACES.sizeBytes,
    sha256: WORLD_PLACES.sha256,
    sourceUrl: "",
    license: WORLD_PLACES.license,
    description: `${WORLD_PLACES.places.toLocaleString("en-US")} cities and towns with 15,000+ people, to find places by name offline`,
    required: false,
  };
}
