import type { Place, PlaceDiet } from "./answerEvents";

type T = (key: string, opts?: Record<string, unknown>) => string;

function numberFormat(locale: string, digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Distance for a place row: under 1 km in metres rounded to 10 m; from 1 km
 * with one decimal up to 10 km, whole kilometres above. Always with a unit.
 */
export function formatDistance(meters: number, locale: string): string {
  const m = Math.max(0, meters);
  const rounded = Math.round(m / 10) * 10;
  if (rounded < 1000) return `${rounded} m`;
  const km = m / 1000;
  const oneDecimal = Math.round(km * 10) / 10;
  if (oneDecimal < 10) return `${numberFormat(locale, 1).format(oneDecimal)} km`;
  return `${numberFormat(locale, 0).format(Math.round(km))} km`;
}

/** The same distance with the unit spelled out, for screen readers ("350 metres"). */
export function spokenDistance(meters: number, locale: string, t: T): string {
  const text = formatDistance(meters, locale);
  const value = text.replace(/\s*(k?m)$/, "");
  return text.endsWith("km") ? t("chat.places.km", { value }) : t("chat.places.m", { value });
}

const DIET_ORDER = ["vegan", "vegetarian", "gluten_free", "halal", "kosher"] as const;

/**
 * Honest diet labels from the tags: "only" is "Vegan", "yes" is "Vegan
 * options", "limited" is "Some vegan options"; "no" and missing say nothing.
 * A vegetarian-only place that also has vegan options reads "Vegetarian, vegan options".
 */
export function dietLabels(diet: Place["diet"], t: T): string[] {
  if (!diet) return [];
  const out: string[] = [];
  for (const key of DIET_ORDER) {
    const v: PlaceDiet | undefined = diet[key];
    if (v === "only" || v === "yes" || v === "limited") out.push(t(`chat.places.diet.${key}.${v}`));
  }
  return out;
}

/** OSM cuisine values ("indian", "fine_dining") as display words, at most `max`. */
export function cuisineLabels(cuisine: string[] | undefined, max = 2): string[] {
  return (cuisine ?? [])
    .filter((c) => c && c !== "vegan" && c !== "vegetarian")
    .slice(0, max)
    .map((c) => c.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()));
}

// ---- opening_hours: a deliberately small subset; anything else is "unknown" ----

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const range = /^([A-Z][a-z])-([A-Z][a-z])$/.exec(part);
    if (range) {
      const a = DAYS.indexOf(range[1]);
      const b = DAYS.indexOf(range[2]);
      if (a < 0 || b < 0) return null;
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
    } else {
      const d = DAYS.indexOf(part);
      if (d < 0) return null;
      out.add(d);
    }
  }
  return [...out];
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

type Span = [number, number];

/** Week schedule: for each day (0 = Monday) its open spans in minutes; end may pass 1440 (after midnight). */
export function parseOpeningHours(raw: string | undefined): Span[][] | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === "24/7") return DAYS.map(() => [[0, 1440]]);
  const week: Span[][] = DAYS.map(() => []);
  for (const ruleRaw of text.split(";")) {
    const rule = ruleRaw.trim();
    if (!rule) continue;
    const m = /^(?:([A-Z][a-z](?:[-,][A-Z][a-z])*)\s+)?(.+)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const timesText = m[2].trim();
    let spans: Span[] = [];
    if (timesText !== "off" && timesText !== "closed") {
      for (const r of timesText.split(",")) {
        const [a, b] = r.trim().split("-");
        const start = toMinutes(a ?? "");
        let end = toMinutes(b ?? "");
        if (start == null || end == null) return null;
        if (end <= start) end += 1440;
        spans.push([start, end]);
      }
    }
    // A later rule replaces earlier ones for the days it names.
    for (const d of days) week[d] = spans;
    spans = [];
  }
  return week;
}

export type OpenState = { open: true; closesAt?: string } | { open: false; opensAt?: string };

const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Open or closed at `now` (device local time), or null when the hours can't be read. */
export function openState(raw: string | undefined, now: Date): OpenState | null {
  const week = parseOpeningHours(raw);
  if (!week) return null;
  const day = (now.getDay() + 6) % 7;
  const minute = now.getHours() * 60 + now.getMinutes();
  const yesterday = (day + 6) % 7;
  if (week.every((spans) => spans.length === 1 && spans[0][0] === 0 && spans[0][1] === 1440)) return { open: true };
  for (const [s, e] of week[yesterday]) {
    if (e > 1440 && minute < e - 1440) return { open: true, closesAt: hhmm(e) };
  }
  for (const [s, e] of week[day]) {
    if (minute >= s && minute < e) return { open: true, closesAt: e >= 1440 && s === 0 && e === 1440 ? undefined : hhmm(e) };
  }
  const later = week[day].filter(([s]) => s > minute).sort((a, b) => a[0] - b[0])[0];
  return { open: false, opensAt: later ? hhmm(later[0]) : undefined };
}

export function openStateLabel(state: OpenState, t: T): string {
  if (state.open) return state.closesAt ? t("chat.places.openUntil", { time: state.closesAt }) : t("chat.places.open");
  return state.opensAt ? t("chat.places.closedOpensAt", { time: state.opensAt }) : t("chat.places.closed");
}

/** Coordinates to paste into an offline maps app (CoMaps, Organic Maps, OsmAnd). */
export function coordinatesText(p: Pick<Place, "lat" | "lon">): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/** A geo: URI that offline maps apps handle without network. */
export function geoUri(p: Pick<Place, "lat" | "lon" | "name">): string {
  const c = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  return `geo:${c}?q=${c}(${encodeURIComponent(p.name)})`;
}

export function sourceName(source: Place["source"], t: T): string {
  return t(source === "osm" ? "chat.places.sourceOsm" : "chat.places.sourceWikivoyage");
}

/**
 * `now` is the device clock, which is only the place's local time when the
 * list is around the device ("near"). For another city pass null: no
 * open/closed is shown rather than a wrong one (places carry no time zone).
 */
export function openStateAt(p: Place, now: Date | null): OpenState | null {
  return now ? openState(p.openingHours, now) : null;
}

/** One sentence per row for screen readers: name, distance, diet, cuisine, hours, address, source. */
export function placeA11yLabel(p: Place, now: Date | null, locale: string, t: T): string {
  const parts = [p.name];
  if (p.distanceM != null) parts.push(spokenDistance(p.distanceM, locale, t));
  parts.push(...dietLabels(p.diet, t), ...cuisineLabels(p.cuisine));
  const state = openStateAt(p, now);
  if (state) parts.push(openStateLabel(state, t));
  if (p.address) parts.push(p.address);
  parts.push(t("chat.places.fromSource", { source: sourceName(p.source, t) }));
  return parts.join(", ");
}

/** The second line of a row: diet, cuisine and open state, " · " separated. */
export function placeDetailLine(p: Place, now: Date | null, t: T): { text: string; closed: boolean } {
  const parts = [...dietLabels(p.diet, t), ...cuisineLabels(p.cuisine)];
  const state = openStateAt(p, now);
  if (state) parts.push(openStateLabel(state, t));
  return { text: parts.join(" · "), closed: state?.open === false };
}

/** The places as plain text, for copy and share. */
export function placesForCopy(places: Place[], now: Date | null, locale: string, t: T): string {
  return places
    .map((p, i) => {
      const bits = [`${i + 1}. ${p.name}`];
      if (p.distanceM != null) bits.push(formatDistance(p.distanceM, locale));
      const detail = placeDetailLine(p, now, t).text;
      if (detail) bits.push(detail);
      if (p.address) bits.push(p.address);
      bits.push(coordinatesText(p), sourceName(p.source, t));
      return bits.join(" · ");
    })
    .join("\n");
}

/** Localized name of the first requested filter ("vegan" → "Vegan"), or null. */
export function filterName(filters: string[] | undefined, t: T): string | null {
  const f = filters?.[0];
  if (!f) return null;
  const key = `chat.places.filter.${f}`;
  const name = t(key);
  return name === key ? f : name;
}

/**
 * The title shown (and announced) when a places answer has no list: no map
 * installed, or nothing recorded for the city / around the device. Null when
 * there are places, or when the card asks for a city instead.
 */
export function placesEmptyTitle(
  r: { coverage: "ok" | "none" | "no_pack" | "needs_place"; places: unknown[]; filters?: string[]; area: { label?: string; place?: { name: string } } },
  t: T
): string | null {
  if (r.coverage === "needs_place") return null;
  if (r.coverage === "no_pack") return t("chat.places.noPackTitle");
  if (r.coverage === "ok" && r.places.length > 0) return null;
  const city = r.area.place?.name ?? r.area.label ?? "";
  const filter = filterName(r.filters, t);
  return city
    ? t(filter ? "chat.places.noneInCityFiltered" : "chat.places.noneInCity", { city, filter })
    : t(filter ? "chat.places.noneNearFiltered" : "chat.places.noneNear", { filter });
}
