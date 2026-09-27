/**
 * Whether an answer carries the "Not a substitute for emergency services"
 * line (Boar, E-1): it used a passage from the Emergency and preparedness
 * pack, or the question is about health or first aid. The word list is a
 * safety net, deliberately broad: a note too many costs a line, one too few
 * can cost more.
 */
export const PREPAREDNESS_PACK_ID = "boar-preparedness";

/** Word starts: "bleed" also matches "bleeding", "sangr" matches "sangramento". EN and PT. */
const HEALTH_STEMS = [
  "first aid", "emergency", "bleed", "blood", "nosebleed", "burn", "wound", "injur", "fractur",
  "broken bone", "sprain", "resuscitat", "chok", "poison", "overdose", "allerg", "anaphyla", "faint",
  "unconscious", "seizure", "heart attack", "stroke", "chest pain", "breath", "drown", "hypotherm",
  "heatstroke", "heat stroke", "dehydrat", "fever", "concussion", "symptom", "medicine", "medication",
  "primeiros socorros", "emergência", "emergencia", "sangr", "hemorrag", "queimad", "ferid", "ferimento",
  "fratur", "osso quebrado", "entors", "reanima", "engasg", "envenen", "intoxica", "overdose", "picada",
  "mordida", "alergi", "desmai", "inconsciente", "convuls", "infarto", "derrame", "dor no peito", "respira",
  "afog", "hipotermia", "insolação", "insolacao", "desidrat", "febre", "concussão", "sintoma", "remédio",
  "remedio", "medicamento",
];

/** Whole words only, where a prefix would catch everyday words ("pain" in "painting", "dor" in "Doral"). */
const HEALTH_WORDS = ["pain", "dor", "dose", "cut", "shock", "choque", "bite", "sting", "cpr", "rcp", "avc", "dores", "cuts", "bites", "stings"];


const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HEALTH_RE = new RegExp(
  `(^|[^\\p{L}])(?:(?:${HEALTH_STEMS.map(esc).join("|")})|(?:${HEALTH_WORDS.map(esc).join("|")})(?![\\p{L}]))`,
  "iu"
);

export function isHealthQuestion(question: string): boolean {
  return HEALTH_RE.test(question);
}

export function usesPreparednessPack(sources: { chunkId: string }[]): boolean {
  return sources.some((s) => s.chunkId.startsWith(`pack:${PREPAREDNESS_PACK_ID}:`));
}

export function needsEmergencyNote(question: string, sources: { chunkId: string }[]): boolean {
  return usesPreparednessPack(sources) || isHealthQuestion(question);
}
